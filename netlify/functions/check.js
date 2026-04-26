const { createCheckHandler } = require("../../shared/station-utils");

const handler = createCheckHandler();

exports.handler = async (event) => {
  if (event?.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "content-type",
        "cache-control": "no-store"
      },
      body: ""
    };
  }

  return handler(event);
};
