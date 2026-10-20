import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "node:path";
import { REQUEST_ID_HEADER } from "./common/request-id.constants.js";
import { AppModule } from "./modules/app.module.js";

async function bootstrap() {
  const port = Number.parseInt(process.env.PORT ?? "4000", 10);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: {
      origin: true,
      credentials: true,
      // Without this, a cross-origin fetch (e.g. local dev: web on :3000, api on :4000)
      // cannot read Retry-After from a 429 response — only the CORS-safelisted headers
      // are visible to JS by default, and Retry-After is not one of them.
      exposedHeaders: ["Retry-After"]
    }
  });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(
    (
      request: { headers: Record<string, string | undefined>; requestId?: string },
      response: { setHeader: (name: string, value: string) => void },
      next: () => void
    ) => {
      const requestId = request.headers[REQUEST_ID_HEADER] ?? randomUUID();
      request.requestId = requestId;
      response.setHeader(REQUEST_ID_HEADER, requestId);
      next();
    }
  );
  app.useStaticAssets(join(process.cwd(), "uploads"), { prefix: "/uploads/" });
  await app.listen(port, "0.0.0.0");
}

bootstrap();
