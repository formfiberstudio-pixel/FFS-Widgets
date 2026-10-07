// How an entry's TOPIC (its project) and TYPE (its category) are stored in a
// tenant's Notion, so Import Photos can create new ones and set them on the
// entries it makes. Two shapes matter (see get-notion-logs.js's buildLogFields,
// which reads them back):
//
//   - relation + rollup (a Projects / Plants database): the topic is a
//     relation to a page in the projects database; the type is a rollup of a
//     property on that page. A new topic is a new page there, and a new type is
//     a value of that page's type property (findProjectTypePropName,
//     projectTypeValue).
//   - select-style (a "Daily Doodles" database with topic / medium selects
//     chosen in Settings): the topic and type are values on the entry's own
//     page. There is nothing to create ahead of time -- Notion adds a new
//     select option the first time a page uses it -- so a new topic or type
//     just has to be written when the entry is (taxonomyProperties).

import { detectFacetSchema, resolveFacetOverride } from '../get-notion-logs.js';
import { notionFetch } from './notionFetch.js';

const MAX_VALUE_LENGTH = 100;

// The property value that sets a property of `propType` to `name`, or null for
// a kind that can't be set this way (a rollup or formula is computed; a status
// can't gain a new option through the API; a relation needs a page to point
// at, see projectTypeValue). Select option names can't contain commas.
export function valueForProperty(propType, name) {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE_LENGTH);
  if (!text) return null;
  switch (propType) {
    case 'select':
      return { select: { name: text.replace(/,/g, ' ').replace(/\s+/g, ' ').trim() } };
    case 'multi_select':
      return { multi_select: [{ name: text.replace(/,/g, ' ').replace(/\s+/g, ' ').trim() }] };
    case 'rich_text':
      return { rich_text: [{ text: { content: text } }] };
    default:
      return null;
  }
}

// This source's configured topic and type properties (the owner's choices in
// Settings, resolved against the entry's own properties), or null for each
// that isn't set. `source` is the tenant's source record ({ label,
// databaseId, topicFacetKey, typeFacetKey }), `refProperties` the properties of
// any existing entry from that database.
export function resolveSourceTaxonomy(refProperties, source) {
  const schema = detectFacetSchema(refProperties);
  const { overrideTopicProp, overrideTypeProp, hasManualOverride } = resolveFacetOverride(schema, source || null);
  return { hasManualOverride, topicProp: overrideTopicProp, typeProp: overrideTypeProp };
}

// The properties to add to a new entry so it carries its topic and type, for
// whichever of the two are select-style. (A relation topic is linked by the
// caller; a rollup type follows from it.)
export function taxonomyProperties(taxonomy, { topicName, typeName }) {
  const properties = {};
  if (taxonomy.topicProp) {
    const value = valueForProperty(taxonomy.topicProp.type, topicName);
    if (value) properties[taxonomy.topicProp.name] = value;
  }
  if (taxonomy.typeProp) {
    const value = valueForProperty(taxonomy.typeProp.type, typeName);
    if (value) properties[taxonomy.typeProp.name] = value;
  }
  return properties;
}

// --------------------------------------------------------------- relation + rollup

const json = async (response) => response.json().catch(() => ({}));

// A database's single data source (its property schema lives there since the
// 2025-09 API), or null when it can't be read.
export async function getDataSource(databaseId, headers) {
  const dbRes = await notionFetch(`https://api.notion.com/v1/databases/${databaseId}`, { method: 'GET', headers });
  if (!dbRes.ok) return null;
  const dataSourceId = (await json(dbRes)).data_sources?.[0]?.id;
  if (!dataSourceId) return null;
  const dsRes = await notionFetch(`https://api.notion.com/v1/data_sources/${dataSourceId}`, { method: 'GET', headers });
  if (!dsRes.ok) return null;
  return { id: dataSourceId, ...(await json(dsRes)) };
}

// Which property of the PROJECTS database holds the type the logs database
// rolls up: the rollup there that goes through `relationPropName` (the
// relation to the projects). `preferredRollupName` picks between several.
export async function findProjectTypePropName(logsDatabaseId, relationPropName, preferredRollupName, headers) {
  const logsSource = await getDataSource(logsDatabaseId, headers);
  const rollups = Object.entries(logsSource?.properties || {})
    .filter(([, prop]) => prop.type === 'rollup' && prop.rollup?.relation_property_name === relationPropName);
  const chosen = rollups.find(([name]) => name === preferredRollupName) || rollups[0];
  return chosen ? chosen[1].rollup.rollup_property_name || null : null;
}

// The page in a relation's target database that is titled `name`, created if
// there is none -- how a type that is itself a page (a "Types" database)
// comes to exist. Resolves to its id, or null if it can't be done.
async function findOrCreateRelatedPage(relationConfig, name, headers) {
  let dataSourceId = relationConfig?.data_source_id;
  if (!dataSourceId && relationConfig?.database_id) {
    dataSourceId = (await getDataSource(relationConfig.database_id, headers))?.id;
  }
  if (!dataSourceId) return null;
  const dsRes = await notionFetch(`https://api.notion.com/v1/data_sources/${dataSourceId}`, { method: 'GET', headers });
  if (!dsRes.ok) return null;
  const titleProp = Object.entries((await json(dsRes)).properties || {}).find(([, p]) => p.type === 'title')?.[0];
  if (!titleProp) return null;

  const queryRes = await notionFetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ filter: { property: titleProp, title: { equals: name } }, page_size: 1 }),
  });
  if (queryRes.ok) {
    const existing = (await json(queryRes)).results?.[0]?.id;
    if (existing) return existing;
  }
  const createRes = await notionFetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties: { [titleProp]: { title: [{ text: { content: name } }] } },
    }),
  });
  const created = await json(createRes);
  return createRes.ok && created.object !== 'error' ? created.id : null;
}

// The value to put in the projects database's type property `prop` (a
// property definition from its schema) so a new project has type `typeName`;
// null when this kind of property can't be set (the caller then creates the
// project without a type and says so).
export async function projectTypeValue(prop, typeName, headers) {
  const name = String(typeName ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE_LENGTH);
  if (!name || !prop) return null;
  switch (prop.type) {
    case 'select':
    case 'multi_select':
    case 'rich_text':
      return valueForProperty(prop.type, name);
    case 'status':
      // A status can only take an option that already exists.
      return prop.status?.options?.some((option) => option.name === name) ? { status: { name } } : null;
    case 'relation': {
      const pageId = await findOrCreateRelatedPage(prop.relation, name, headers);
      return pageId ? { relation: [{ id: pageId }] } : null;
    }
    default:
      return null;
  }
}
