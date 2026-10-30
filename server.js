// A URL shortener. Setup: the service starts on PORT and answers a request.
const http = require("node:http");

const PORT = Number(process.env.PORT || 8080);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("URL shortener is running\n");
});

server.listen(PORT, () => console.log(`listening on ${PORT}`));
