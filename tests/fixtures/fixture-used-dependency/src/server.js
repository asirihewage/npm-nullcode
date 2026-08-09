const express = require("express");
const moment = require("moment");
const app = express();
app.get("/", (req, res) => res.send(moment().format()));
module.exports = app;
