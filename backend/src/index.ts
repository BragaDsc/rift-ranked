/**
 * Entrypoint do backend ranked.
 *
 * Dev: usa o repositório em memória (sem Postgres). Para produção, trocar por
 * uma implementação `Repository` baseada em `pg` (mesmo contrato) — nada mais muda.
 */
import { startServer } from "./server/wsServer.js";
import { InMemoryRepository } from "./server/repository.js";
import { PgRepository } from "./server/pgRepository.js";
const port = Number(process.env.PORT ?? 4100);
// Com DATABASE_URL usa Postgres (produção); sem ela, memória (dev).
const repo = process.env.DATABASE_URL
    ? new PgRepository(process.env.DATABASE_URL)
    : new InMemoryRepository();
console.log(`[ranked] repositório: ${process.env.DATABASE_URL ? "PostgreSQL" : "memória"}`);
const server = startServer({ repo, port });
function shutdown(signal) {
    console.log(`\n[ranked] recebido ${signal}, encerrando...`);
    server.stop().then(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
