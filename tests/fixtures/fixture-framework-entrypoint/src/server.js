const { routes } = require("./routes");
const http = require("http");
http.createServer(routes).listen(3000);
