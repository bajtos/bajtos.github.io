'use strict';

const { URL } = require('url');
const { v4: uuidv4 } = require('uuid');

exports.handler = async function dot(event, context) {
  const pageUrl = event.headers.referer;
  const parsedUrl = pageUrl ? new URL(pageUrl) : {};

  const ts = new Date().toISOString();
  const data = {
    id: uuidv4(),
    date: ts.split('T')[0],
    timestamp: ts,
    url: pageUrl,
    hostname: parsedUrl.hostname,
    pathname: parsedUrl.pathname,
    production: parsedUrl.hostname === 'bajtos.net',
    userAgent: event.headers['user-agent'],
    clientIP: event.headers['client-ip'],
  };

  console.log('Received event', data);

  return {
    statusCode: 204,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: 0,
    },
  };
};
