const url = process.env.EMS_RELAY_WS_PROBE_URL;

if (!url?.startsWith("wss://")) {
  console.error("Missing secure WebSocket probe URL.");
  process.exit(1);
}

const timer = setTimeout(() => {
  console.error("WebSocket handshake timed out.");
  process.exit(2);
}, 15_000);

const socket = new WebSocket(url);
socket.addEventListener("open", () => {
  clearTimeout(timer);
  console.log(JSON.stringify({ connected: true, protocol: "wss", ticketConsumed: true }));
  socket.close(1000, "probe complete");
});
socket.addEventListener("error", () => {
  clearTimeout(timer);
  console.error("WebSocket connection failed.");
  process.exit(3);
});
