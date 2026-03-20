/**
 * Salesforce API Adapter
 */
import axios from 'axios';

// Maps our target table nouns to Salesforce SOQL objects
const SF_OBJECTS = {
  'contacts': 'Contact',
  'companies': 'Account',
  'deals': 'Opportunity',
  'leads': 'Lead'
};

const SF_FIELDS = {
  'Contact': 'Id, FirstName, LastName, Email, Phone, MobilePhone, Title, Department, LeadSource, AccountId, OwnerId',
  'Account': 'Id, Name, Website, Industry, Phone, NumberOfEmployees, AnnualRevenue, BillingStreet, BillingCity, BillingState, BillingPostalCode, BillingCountry',
  'Opportunity': 'Id, Name, Amount, StageName, CloseDate, Probability, Type, LeadSource, CurrencyIsoCode',
  'Lead': 'Id, FirstName, LastName, Email, Phone, Company, Title, LeadSource, Status'
};

export async function fetchData(objectType, credentials, instanceUrl) {
  const { access_token } = credentials;
  const sfObject = SF_OBJECTS[objectType] || objectType;
  const fields = SF_FIELDS[sfObject] || 'Id, Name';
  
  if (!access_token || !instanceUrl) {
    throw new Error('Missing Salesforce access_token or instance_url');
  }

  // Use the standard SOQL endpoint
  const queryUrl = `${instanceUrl}/services/data/v58.0/query`;
  const q = `SELECT ${fields} FROM ${sfObject} ORDER BY LastModifiedDate DESC LIMIT 1000`; // Limit to 1000 for demo

  try {
    const response = await axios.get(queryUrl, {
      headers: {
        Authorization: `Bearer ${access_token}`
      },
      params: { q }
    });

    // Extract the records array from the Salesforce response
    return response.data.records || [];
  } catch (error) {
    console.error('Salesforce API Error:', error.response?.data || error.message);
    throw new Error(`Failed to fetch ${objectType} from Salesforce: ${error.message}`);
  }
}

export function getExternalId(record) {
  return record.Id;
}
