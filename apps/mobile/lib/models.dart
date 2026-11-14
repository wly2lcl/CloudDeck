class Project {
  const Project({
    required this.id,
    required this.name,
    this.description,
    required this.createdAt,
  });

  final String id;
  final String name;
  final String? description;
  final DateTime createdAt;

  factory Project.fromJson(Map<String, dynamic> json) => Project(
        id: json['id'] as String,
        name: json['name'] as String,
        description: json['description'] as String?,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

class Asset {
  const Asset({
    required this.assetId,
    required this.projectId,
    required this.type,
    required this.name,
    required this.mime,
    required this.size,
    required this.latestVersion,
  });

  final String assetId;
  final String projectId;
  final String type;
  final String name;
  final String mime;
  final int size;
  final int latestVersion;

  factory Asset.fromJson(Map<String, dynamic> json) => Asset(
        assetId: json['assetId'] as String,
        projectId: json['projectId'] as String,
        type: json['type'] as String,
        name: json['name'] as String,
        mime: json['mime'] as String,
        size: (json['size'] as num).toInt(),
        latestVersion: (json['latestVersion'] as num).toInt(),
      );
}

class Capability {
  const Capability({
    required this.id,
    required this.version,
    required this.name,
    required this.description,
    required this.category,
    required this.estimate,
    required this.unit,
    required this.inputTypes,
  });

  final String id;
  final String version;
  final String name;
  final String description;
  final String category;
  final double estimate;
  final String unit;
  final List<String> inputTypes;

  factory Capability.fromJson(Map<String, dynamic> json) {
    final manifest = json['manifest'] as Map<String, dynamic>?;
    final inputs = (manifest?['inputs'] as List<dynamic>?) ?? const [];
    return Capability(
      id: json['id'] as String,
      version: json['version'] as String,
      name: json['name'] as String,
      description: (json['description'] as String?) ?? '',
      category: json['category'] as String,
      estimate: ((json['estimate'] as num?) ?? 0).toDouble(),
      unit: (json['unit'] as String?) ?? '',
      inputTypes: inputs
          .map((input) => (input as Map<String, dynamic>)['assetTypes'] as List<dynamic>)
          .expand((types) => types.cast<String>())
          .toList(),
    );
  }
}

class JobOutput {
  const JobOutput({
    required this.assetId,
    required this.version,
    required this.name,
    required this.type,
  });

  final String assetId;
  final int version;
  final String name;
  final String type;

  factory JobOutput.fromJson(Map<String, dynamic> json) => JobOutput(
        assetId: json['assetId'] as String,
        version: (json['version'] as num).toInt(),
        name: json['name'] as String,
        type: json['type'] as String,
      );
}

class Job {
  const Job({
    required this.jobId,
    required this.projectId,
    required this.capabilityId,
    required this.status,
    required this.estimatedCostUsd,
    required this.actualCostUsd,
    required this.outputs,
    required this.resumable,
    this.errorCode,
    this.errorMessage,
  });

  final String jobId;
  final String projectId;
  final String capabilityId;
  final String status;
  final double estimatedCostUsd;
  final double actualCostUsd;
  final List<JobOutput> outputs;
  final bool resumable;
  final String? errorCode;
  final String? errorMessage;

  bool get terminal =>
      status == 'succeeded' || status == 'failed' || status == 'cancelled';

  factory Job.fromJson(Map<String, dynamic> json) => Job(
        jobId: json['jobId'] as String,
        projectId: json['projectId'] as String,
        capabilityId: json['capabilityId'] as String,
        status: json['status'] as String,
        estimatedCostUsd: ((json['estimatedCostUsd'] as num?) ?? 0).toDouble(),
        actualCostUsd: ((json['actualCostUsd'] as num?) ?? 0).toDouble(),
        outputs: ((json['outputs'] as List<dynamic>?) ?? const [])
            .map((output) => JobOutput.fromJson(output as Map<String, dynamic>))
            .toList(),
        resumable: (json['resumable'] as bool?) ?? false,
        errorCode: json['errorCode'] as String?,
        errorMessage: json['errorMessage'] as String?,
      );
}

class JobLog {
  const JobLog({
    required this.seq,
    required this.type,
    required this.at,
    required this.payload,
  });

  final int seq;
  final String type;
  final DateTime at;
  final Map<String, dynamic> payload;

  String get summary {
    switch (type) {
      case 'progress':
        return '${payload['percent']}% ${payload['message'] ?? ''}'.trim();
      case 'log':
        return (payload['message'] as String?) ?? '';
      case 'error':
        return '${payload['code']}: ${payload['message']}';
      case 'usage':
        return '成本 ${payload['costUsd']} USD';
      case 'done':
        return '完成';
      default:
        return type;
    }
  }

  factory JobLog.fromJson(Map<String, dynamic> json) => JobLog(
        seq: (json['seq'] as num).toInt(),
        type: json['type'] as String,
        at: DateTime.parse(json['at'] as String),
        payload: (json['payload'] as Map<String, dynamic>?) ?? const {},
      );
}
