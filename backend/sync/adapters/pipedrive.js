/**
 * Pipedrive API Adapter
 */
import axios from 'axios';

const REQUEST_TIMEOUT_MS = 20_000;
const PAGE_LIMIT = 500;

const OBJECT_ENDPOINTS = {
  persons: 'persons',
  organizations: 'organizations',
  deals: 'deals',
};

export async function fetchData(objectType, credentials, instanceUrl) {
  const endpoint = OBJECT_ENDPOINTS[objectType];
  if (!endpoint) {
    throw new Error(`Unsupported Pipedrive object type: ${objectType}`);
  }

  const apiToken = credentials?.apiKey || credentials?.accessKey || credentials?.api_token;
  const accessToken = credentials?.access_token || credentials?.accessToken;
  const baseUrl = normalizeBaseUrl(instanceUrl || credentials?.instanceUrl);

  if (!apiToken && !accessToken) {
    throw new Error('Missing Pipedrive credentials (API token or OAuth access token)');
  }
  if (!baseUrl) {
    throw new Error('Missing Pipedrive instance URL (e.g. https://yourcompany.pipedrive.com)');
  }

  let start = 0;
  let hasMore = true;
  const records = [];

  while (hasMore && records.length < 5_000) {
    const response = await axios.get(`${baseUrl}/api/v1/${endpoint}`, {
      params: {
        start,
        limit: PAGE_LIMIT,
        ...(apiToken ? { api_token: apiToken } : {}),
      },
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : undefined,
      timeout: REQUEST_TIMEOUT_MS,
    });

    const pageData = response?.data?.data || [];
    records.push(...pageData);

    const pagination = response?.data?.additional_data?.pagination;
    hasMore = Boolean(pagination?.more_items_in_collection);
    start = Number(pagination?.next_start || 0);

    if (!hasMore || !start) break;
  }

  return records;
}

export function getExternalId(record) {
  return record?.id;
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
