import { describe, it, expect } from 'vitest';
import { sanitizeInput, validateIdea, validateEmail, validatePassword } from '@/lib/validation';

describe('Validation Utils', () => {
  describe('sanitizeInput', () => {
    it('should remove HTML tags', () => {
      expect(sanitizeInput('<script>alert("xss")</script>')).toBe('scriptalert("xss")/script');
    });

    it('should remove javascript: protocol', () => {
      expect(sanitizeInput('javascript:alert(1)')).toBe('alert(1)');
    });

    it('should remove event handlers', () => {
      expect(sanitizeInput('onclick=alert(1)')).toBe('alert(1)');
    });

    it('should trim whitespace', () => {
      expect(sanitizeInput('  hello  ')).toBe('hello');
    });
  });

  describe('validateIdea', () => {
    it('should reject empty input', () => {
      const result = validateIdea('');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('请输入创作想法');
    });

    it('should reject input less than 10 characters', () => {
      const result = validateIdea('short');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('创作想法至少需要 10 个字符');
    });

    it('should reject input more than 100000 characters (full-script ceiling)', () => {
      // v2.x: 上限从 2000 提升到 100000 以支持完整剧本输入(常见 5000-50000 字)
      const result = validateIdea('a'.repeat(100001));
      expect(result.valid).toBe(false);
      expect(result.error).toBe('输入内容不能超过 100000 个字符');
    });

    it('should accept long full-script input up to 100000 characters', () => {
      const result = validateIdea('剧本'.repeat(20000)); // ≈40k chars
      expect(result.valid).toBe(true);
    });

    it('should accept valid input', () => {
      const result = validateIdea('This is a valid story idea with enough characters');
      expect(result.valid).toBe(true);
    });
  });

  describe('validateEmail', () => {
    it('should accept valid email', () => {
      expect(validateEmail('test@example.com')).toBe(true);
    });

    it('should reject invalid email', () => {
      expect(validateEmail('invalid-email')).toBe(false);
      expect(validateEmail('test@')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
    });
  });

  describe('validatePassword', () => {
    it('should reject password less than 8 characters', () => {
      const result = validatePassword('Short1');
      expect(result.valid).toBe(false);
    });

    it('should reject password without uppercase', () => {
      const result = validatePassword('password123');
      expect(result.valid).toBe(false);
    });

    it('should reject password without lowercase', () => {
      const result = validatePassword('PASSWORD123');
      expect(result.valid).toBe(false);
    });

    it('should reject password without number', () => {
      const result = validatePassword('Password');
      expect(result.valid).toBe(false);
    });

    it('should accept valid password', () => {
      const result = validatePassword('Password123');
      expect(result.valid).toBe(true);
    });
  });
});
