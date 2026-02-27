import type { FastifyReply, FastifyRequest } from "fastify";

export function extractBearer(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return undefined;
  return token;
}

export function requireServiceToken(
  req: FastifyRequest,
  reply: FastifyReply,
  expectedToken: string
): boolean {
  const token = req.headers["x-ao-service-token"];
  if (!expectedToken) return true;
  if (typeof token !== "string" || token !== expectedToken) {
    void reply.code(401).send({ error: "unauthorized", message: "invalid service token" });
    return false;
  }
  return true;
}

