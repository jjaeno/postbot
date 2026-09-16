import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import type { ErrorResponse } from "@postbot/contracts";

const codeFromStatus = (status: HttpStatus): string => {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "BAD_REQUEST";
    case HttpStatus.UNAUTHORIZED:
      return "UNAUTHORIZED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.CONFLICT:
      return "CONFLICT";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "RATE_LIMITED";
    default:
      return "INTERNAL_ERROR";
  }
};

const messageFromException = (exception: unknown): string => {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (typeof response === "string") {
      return response;
    }
    if (response && typeof response === "object" && "message" in response) {
      const message = response.message;
      if (typeof message === "string") {
        return message;
      }
      if (Array.isArray(message) && typeof message[0] === "string") {
        return message[0];
      }
    }
  }
  return "요청을 처리하지 못했습니다.";
};

@Catch()
export class HttpExceptionResponseFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body: ErrorResponse = {
      message: messageFromException(exception),
      code: codeFromStatus(status)
    };
    response.status(status).json(body);
  }
}
