import { z } from 'zod'

export const assetTypeSchema = z.enum([
  'novel_manuscript',
  'story_bible',
  'character_card',
  'script',
  'storyboard',
  'shot_list',
  'voice_profile',
  'audio_track',
  'music_bed',
  'image',
  'video_timeline',
  'video',
  'code_workspace',
  'patch',
  'document',
  'dataset',
])

export type AssetType = z.infer<typeof assetTypeSchema>

export const assetVersionRefSchema = z.strictObject({
  assetId: z.string().min(1),
  version: z.number().int().positive(),
})

export const assetRefSchema = z.strictObject({
  assetId: z.string().min(1),
  version: z.number().int().positive(),
  type: assetTypeSchema,
  name: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  checksum: z.string().min(1),
  derivedFrom: z.array(assetVersionRefSchema).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})

export type AssetRef = z.infer<typeof assetRefSchema>
export type AssetVersionRef = z.infer<typeof assetVersionRefSchema>
