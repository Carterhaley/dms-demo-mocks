/**
 * Minimal Server-Sent Events hub for /ops/events (spec section 38). Chosen
 * over WebSockets per spec instruction -- SSE is one-way (server -> browser),
 * which is all this needs (health changes, scenario progress, reset
 * progress, activity feed), and Express can do it with no extra dependency.
 */

const clients = new Set();

function handler(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

function broadcast(type, payload) {
  const line = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}

module.exports = { handler, broadcast };
