// Where the website reaches OCCPL's tracking API. "/api/v1" = the same domain: the web server (nginx.conf)
// forwards /api/v1/track/ to the courier backend. To call the backend directly instead, put its full address here,
// e.g. "https://courier.dev.occplsoftech.com/api/v1", and allow this website's domain in the backend's CORS list.
window.OCCPL_CONFIG = {
  apiBase: '/api/v1'
};
