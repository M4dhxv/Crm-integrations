/**
 * Gong API Adapter
 */
import axios from 'axios';

const REQUEST_TIMEOUT_MS = 25_000;

const OBJECT_ENDPOINTS = {
  calls: 'calls',
};

export async function fetchData(objectType, credentials, instanceUrl) {
  const endpoint = OBJECT_ENDPOINTS[objectType];
  if (!endpoint) {
    throw new Error(`Unsupported Gong object type: ${objectType}`);
  }

  const accessKey = credentials?.accessKey || credentials?.access_key;
  const secretKey = credentials?.apiKey || credentials?.secretKey || credentials?.secret_key;
  if (!accessKey || !secretKey) {
    throw new Error('Missing Gong access key or secret key');
  }

  const baseUrl = normalizeBaseUrl(instanceUrl || credentials?.instanceUrl || 'https://api.gong.io');
  const auth = Buffer.from(`${accessKey}:${secretKey}`).toString('base64');

  // Preferred endpoint (v2 calls with richer payload)
  try {
    const body = {
      filter: {
        fromDateTime: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
      limit: 200,
    };

    const response = await axios.post(`${baseUrl}/v2/calls/extensive`, body, {
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const calls = response?.data?.calls || response?.data?.records || response?.data?.data || [];
    return calls.map(toNormalizedGongCall);
  } catch (primaryError) {
    // Fallback endpoint for workspaces that only expose /v2/calls
    const response = await axios.get(`${baseUrl}/v2/calls`, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    const calls = response?.data?.calls || response?.data?.records || response?.data?.data || [];
    return calls.map(toNormalizedGongCall);
  }
}

export function getExternalId(record) {
  return record?.id;
}

function toNormalizedGongCall(call) {
  const content = call?.content || {};
  const topics = content?.topics || call?.topics || [];

  return {
    id: call?.id || call?.callId,
    title: call?.title || call?.name || null,
    started: call?.started || call?.startTime || call?.scheduled || null,
    duration: call?.duration || call?.durationSeconds || null,
    direction: call?.direction || null,
    media: {
      url: call?.media?.url || call?.url || null,
    },
    parties: call?.parties || call?.participants || [],
    content: {
      topics,
    },
  };
}

function normalizeBaseUrl(input) {
  const value = String(input || '').trim();
  if (!value) return null;

  let base = value;
  if (!/^https?:\/\//i.test(base)) {
    base = `https://${base}`;
  }

  try {
    const url = new URL(base);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}
