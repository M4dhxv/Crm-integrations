/**
 * HubSpot API Adapter
 */
import axios from 'axios';

const HS_OBJECTS = {
  'contacts': 'contacts',
  'companies': 'companies',
  'deals': 'deals'
};

const HS_PROPERTIES = {
  'contacts': 'firstname,lastname,email,phone,jobtitle,company,lifecyclestage',
  'companies': 'name,domain,industry,phone,website',
  'deals': 'dealname,amount,dealstage,closedate,pipeline'
};

export async function fetchData(objectType, credentials) {
  const { access_token } = credentials;
  const hsObject = HS_OBJECTS[objectType] || objectType;
  const properties = HS_PROPERTIES[hsObject] || '';
  
  if (!access_token) {
    throw new Error('Missing HubSpot access_token');
  }

  // We use the v3 Search API to get all records for an object type
  // In a real production app we'd paginate using 'after', but for demo limit to 100
  const searchUrl = `https://api.hubapi.com/crm/v3/objects/${hsObject}/search`;
  
  try {
    const response = await axios.post(searchUrl, {
      limit: 100,
      properties: properties.split(',')
    }, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      }
    });

    // For HubSpot, the payload is the full object. We adjust our extractor for standardizer.
    // The standardizer expects the hubspot nested format OR we can flat it here.
    // Our normalizer (field-maps) looks config.path = 'properties.firstname.value'
    // BUT the v3 API returns { id: '123', properties: { firstname: 'John' } } (not .value).
    // So let's transform the v3 response slightly so our existing field-maps work seamlessly:
    
    return (response.data.results || []).map(record => {
      // Convert { properties: { email: "a@b.com" }} 
      // to { properties: { email: { value: "a@b.com" } } } to match the HubSpot v1 map structure
      const mappedRecord = { id: record.id, properties: {} };
      if (record.properties) {
        for (const [k, v] of Object.entries(record.properties)) {
          mappedRecord.properties[k] = { value: v };
        }
      }
      return mappedRecord;
    });

  } catch (error) {
    console.error('HubSpot API Error:', error.response?.data || error.message);
    throw new Error(`Failed to fetch ${objectType} from HubSpot: ${error.message}`);
  }
}

export function getExternalId(record) {
  return record.id || record.vid || record.companyId || record.dealId;
}
