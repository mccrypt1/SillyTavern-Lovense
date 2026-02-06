import http from 'http';
import https from 'https';
import crypto from 'crypto';

/**
 * Plugin metadata
 */
export const info = {
    id: 'lovense',
    name: 'Lovense Control Plugin',
    description: 'Proxy endpoint for Lovense API requests to bypass CORS and handle self-signed certificates',
};

/**
 * Create an HTTPS agent configured for Lovense device connections.
 * Lovense mobile/desktop apps use self-signed or *.lovense.club certs
 * that may not be compatible with Node.js's default strict TLS settings.
 */
function createLovenseAgent() {
    return new https.Agent({
        rejectUnauthorized: false,
        // Allow connections to servers with legacy/non-standard TLS
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
        // Minimum TLS version — Lovense apps may use TLS 1.2
        minVersion: 'TLSv1.2',
        // Keep connections alive to avoid repeated handshake overhead
        keepAlive: true,
    });
}

const lovenseHttpsAgent = createLovenseAgent();
const lovenseHttpAgent = new http.Agent({ keepAlive: true });

/**
 * Initialize the plugin
 * @param {import('express').Router} router - Express router for this plugin
 */
export async function init(router) {
    console.log('Loading Lovense Control server plugin...');

    /**
     * Proxy endpoint for Lovense API requests
     * This allows bypassing CORS and self-signed certificate issues
     */
    router.post('/command', async (req, res) => {
        const { url, ...commandData } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        try {
            const urlObj = new URL(url);
            const postData = JSON.stringify(commandData);
            const isHttps = urlObj.protocol === 'https:';
            const transport = isHttps ? https : http;

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'X-platform': 'SillyTavern',
                },
                agent: isHttps ? lovenseHttpsAgent : lovenseHttpAgent,
                // Connection timeout (10 seconds)
                timeout: 10000,
            };

            const proxyReq = transport.request(options, (proxyRes) => {
                let data = '';

                proxyRes.on('data', (chunk) => {
                    data += chunk;
                });

                proxyRes.on('end', () => {
                    try {
                        const jsonData = JSON.parse(data);
                        res.json(jsonData);
                    } catch (error) {
                        console.error('[Lovense] Failed to parse response:', error);
                        res.status(500).json({ error: 'Invalid response from Lovense device' });
                    }
                });
            });

            proxyReq.on('timeout', () => {
                proxyReq.destroy();
                console.error('[Lovense] Request timed out');
                res.status(504).json({
                    error: 'Connection to Lovense device timed out',
                    details: 'The device did not respond within 10 seconds. Make sure the Lovense app is open and on the same network.',
                });
            });

            proxyReq.on('error', (error) => {
                console.error('[Lovense] Proxy request error:', error);
                res.status(500).json({
                    error: 'Failed to connect to Lovense device',
                    details: error.message,
                });
            });

            proxyReq.write(postData);
            proxyReq.end();
        } catch (error) {
            console.error('[Lovense] Error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    console.log('Lovense Control server plugin loaded successfully');
}
