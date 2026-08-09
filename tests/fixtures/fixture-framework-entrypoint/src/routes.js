const { utilities } = require("./utilities");
exports.routes = (req, res) => res.end(utilities.greet());
