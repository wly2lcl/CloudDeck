'use client'

import type { ProjectGraph } from '../lib/api'

const RANK: Record<string, number> = {
  story_bible: 0,
  novel_manuscript: 1,
  document: 1,
  script: 2,
  dataset: 2,
  voice_profile: 2,
  storyboard: 3,
  image: 3,
  shot_list: 4,
  audio_track: 5,
  video: 6,
  video_timeline: 6,
  code_workspace: 1,
  patch: 2,
  music_bed: 5,
  character_card: 0,
}

const COLUMN_WIDTH = 180
const NODE_WIDTH = 140
const NODE_HEIGHT = 40
const GAP = 14
const PAD = 20

function shorten(value: string, max = 16): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export function ContentGraph({
  graph,
  onSelect,
}: {
  graph: ProjectGraph
  onSelect: (assetId: string) => void
}) {
  if (graph.assets.length === 0) {
    return <p className="muted">还没有资产，内容链会在上传与运行后出现。</p>
  }

  const columns = new Map<number, ProjectGraph['assets']>()
  for (const asset of graph.assets) {
    const rank = RANK[asset.type] ?? 0
    const list = columns.get(rank) ?? []
    list.push(asset)
    columns.set(rank, list)
  }

  const ranks = [...columns.keys()].sort((a, b) => a - b)
  const maxRank = ranks[ranks.length - 1] ?? 0
  const maxRows = Math.max(1, ...[...columns.values()].map((list) => list.length))
  const width = PAD * 2 + (maxRank + 1) * COLUMN_WIDTH
  const height = PAD * 2 + maxRows * (NODE_HEIGHT + GAP)

  const positions = new Map<string, { x: number; y: number }>()
  for (const rank of ranks) {
    const list = columns.get(rank) ?? []
    list.forEach((asset, index) => {
      positions.set(asset.assetId, {
        x: PAD + rank * COLUMN_WIDTH,
        y: PAD + index * (NODE_HEIGHT + GAP),
      })
    })
  }

  return (
    <div className="graph-scroll">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="graph"
        style={{ maxWidth: width }}
        preserveAspectRatio="xMinYMin meet"
      >
        <defs>
          <marker
            id="chain-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#3f5468" />
          </marker>
        </defs>

        {graph.links.map((link, index) => {
          const from = positions.get(link.fromAssetId)
          const to = positions.get(link.toAssetId)
          if (!from || !to) return null
          const x1 = from.x + NODE_WIDTH
          const y1 = from.y + NODE_HEIGHT / 2
          const x2 = to.x
          const y2 = to.y + NODE_HEIGHT / 2
          return (
            <line
              key={`${link.fromAssetId}-${link.toAssetId}-${index}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#3f5468"
              strokeWidth="1.5"
              markerEnd="url(#chain-arrow)"
            />
          )
        })}

        {graph.assets.map((asset) => {
          const position = positions.get(asset.assetId)
          if (!position) return null
          return (
            <g
              key={asset.assetId}
              transform={`translate(${position.x}, ${position.y})`}
              className="graph-node"
              onClick={() => onSelect(asset.assetId)}
              role="button"
              tabIndex={0}
            >
              <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={8} />
              <text x={10} y={17} className="graph-title">
                {shorten(asset.name)}
              </text>
              <text x={10} y={32} className="graph-subtitle">
                {asset.type} · v{asset.latestVersion}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
