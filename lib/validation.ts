// 输入验证和清理工具

export function sanitizeInput(input: string): string {
  return input
    .replace(/[<>]/g, '') // 移除 < >
    .replace(/javascript:/gi, '') // 移除 javascript: 协议
    .replace(/on\w+=/gi, '') // 移除事件处理器
    .trim();
}

export function validateIdea(idea: string): { valid: boolean; error?: string } {
  if (!idea || idea.trim().length === 0) {
    return { valid: false, error: '请输入创作想法' };
  }

  if (idea.length < 10) {
    return { valid: false, error: '创作想法至少需要 10 个字符' };
  }

  // 支持完整剧本输入：真实剧本通常 5000-50000 字符
  // 短创意上限 2000，完整剧本上限 100000
  if (idea.length > 100000) {
    return { valid: false, error: '输入内容不能超过 100000 个字符' };
  }

  return { valid: true };
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: '密码至少需要 8 个字符' };
  }

  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: '密码需要包含至少一个大写字母' };
  }

  if (!/[a-z]/.test(password)) {
    return { valid: false, error: '密码需要包含至少一个小写字母' };
  }

  if (!/[0-9]/.test(password)) {
    return { valid: false, error: '密码需要包含至少一个数字' };
  }

  return { valid: true };
}
