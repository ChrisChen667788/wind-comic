// API 路由错误处理中间件

import { NextRequest, NextResponse } from 'next/server';
import { AppError, handleApiError, logError } from './error-handler';
import { validateIdea, sanitizeInput } from './validation';

export function withErrorHandler(
  handler: (req: NextRequest) => Promise<Response>
) {
  return async (req: NextRequest) => {
    try {
      return await handler(req);
    } catch (error) {
      const appError = handleApiError(error);
      logError(appError, { url: req.url, method: req.method });

      return NextResponse.json(
        { error: appError.message, code: appError.code },
        { status: appError.statusCode || 500 }
      );
    }
  };
}

export function validateCreateRequest(body: any) {
  if (!body.idea) {
    throw new AppError('请提供故事创意', 'MISSING_IDEA', 400);
  }

  const validation = validateIdea(body.idea);
  if (!validation.valid) {
    throw new AppError(validation.error || '输入无效', 'INVALID_IDEA', 400);
  }

  if (!body.videoProvider) {
    throw new AppError('请选择视频生成引擎', 'MISSING_PROVIDER', 400);
  }

  const validProviders = ['minimax', 'vidu', 'keling'];
  if (!validProviders.includes(body.videoProvider)) {
    throw new AppError('无效的视频生成引擎', 'INVALID_PROVIDER', 400);
  }

  return {
    idea: sanitizeInput(body.idea),
    videoProvider: body.videoProvider,
  };
}
