// cytoscape-fcose ships no type definitions; this ambient declaration types it as
// a standard Cytoscape extension registration function (used via cytoscape.use).
declare module 'cytoscape-fcose' {
  import type cytoscape from 'cytoscape';
  const fcose: cytoscape.Ext;
  export default fcose;
}
