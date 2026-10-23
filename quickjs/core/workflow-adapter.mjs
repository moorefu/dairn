/* Declarative, advisory workflow mapping. It cannot alter policy or gates. */
const STATES = new Set(['orient','grill','specify','slice','implement','review','synchronize','complete']);
function error(message) { throw Error('Workflow mapping: ' + message); }
export function validateWorkflowMapping(mapping) {
  const errors = [];
  if (!mapping || mapping.schema !== 'dairn.workflow-mapping.v1') errors.push('schema must be dairn.workflow-mapping.v1');
  if (mapping?.adapter !== 'declarative' || mapping?.mode !== 'advisory') errors.push('adapter/mode must be declarative/advisory');
  if (!mapping?.states || typeof mapping.states !== 'object' || Array.isArray(mapping.states)) errors.push('states must be object');
  else for (const [key, value] of Object.entries(mapping.states)) {
    if (typeof key !== 'string' || !key.length || typeof value !== 'string' || !STATES.has(value)) errors.push('invalid state mapping: ' + key);
  }
  for (const key of ['exec','override','pass','required_checks','policy']) if (Object.prototype.hasOwnProperty.call(mapping || {}, key)) errors.push('forbidden key: ' + key);
  return errors;
}
export function adaptWorkflow(mapping, state) {
  const errors = validateWorkflowMapping(mapping); if (errors.length) error(errors.join('; '));
  return mapping.states[state] || null;
}
export function defaultWorkflowMapping() {
  return {schema:'dairn.workflow-mapping.v1', adapter:'declarative', mode:'advisory', states:{Backlog:'orient',Doing:'implement',Testing:'review','In Review':'review',Done:'complete'}};
}
