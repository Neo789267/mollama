export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly expose: boolean;

  constructor(statusCode: number, code: string, message: string, options?: { expose?: boolean }) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.expose = options?.expose ?? true;
  }
}

export function badRequest(message: string, code = 'bad_request'): AppError {
  return new AppError(400, code, message);
}

export function notFound(message: string, code = 'not_found'): AppError {
  return new AppError(404, code, message);
}

export function badGateway(message: string, code = 'bad_gateway'): AppError {
  return new AppError(502, code, message);
}

export function gatewayTimeout(message: string, code = 'gateway_timeout'): AppError {
  return new AppError(504, code, message);
}

export function notImplemented(message: string, code = 'not_implemented'): AppError {
  return new AppError(501, code, message);
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
