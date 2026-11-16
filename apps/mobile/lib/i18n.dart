import 'package:flutter/foundation.dart';

enum AppLocale { zh, en }

final ValueNotifier<AppLocale> appLocale = ValueNotifier(AppLocale.zh);

const Map<String, String> _en = {
  '登录': 'Sign in',
  '邮箱': 'Email',
  '密码': 'Password',
  '昵称（可选）': 'Display name (optional)',
  '注册并登录': 'Create account',
  '没有账号？创建一个': 'No account? Create one',
  '已有账号？去登录': 'Already have an account? Sign in',
  '创建你的内容工作空间': 'Create your workspace',
  '登录你的内容工作台': 'Sign in to your content workbench',
  '请稍候…': 'Working…',
  '新建项目': 'New project',
  '项目名称': 'Project name',
  '创建': 'Create',
  '取消': 'Cancel',
  '关闭': 'Close',
  '提交': 'Submit',
  '还没有项目，先创建一个。': 'No projects yet. Create the first one.',
  '资产': 'Assets',
  '能力': 'Capabilities',
  '内容链': 'Content chain',
  '评论': 'Comments',
  '发送': 'Send',
  '写一条评论…': 'Write a comment…',
  '还没有评论。': 'No comments yet.',
  '设置': 'Settings',
  '租户': 'Tenants',
  '本月配额': 'Quota this month',
  '当前用户': 'Current user',
  '退出登录': 'Sign out',
  '推送注册': 'Push registration',
  '注册推送': 'Register device',
  '运行': 'Run',
  '续作': 'Resume',
  '重试': 'Retry',
  '产物': 'Outputs',
  '事件': 'Events',
  '任务': 'Job',
  '模式': 'Mode',
  '续写': 'Continue',
  '改写': 'Rewrite',
  '一致性检查': 'Consistency check',
  '写作指令': 'Instruction',
  '输入': 'Input',
};

String tr(String zh) => appLocale.value == AppLocale.en ? (_en[zh] ?? zh) : zh;
