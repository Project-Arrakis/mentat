// An HTTP error answer from a Console, shared by adapterClient.js and
// consoleAtlas.js.
export class AdapterHttpError extends Error {
  constructor(message, { status, route, body }) {
    super(message);
    this.name = "AdapterHttpError";
    this.status = status;
    this.route = route;
    this.body = body;
  }
}
