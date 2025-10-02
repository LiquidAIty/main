import React from 'react';
import {
  List,
  Datagrid,
  TextField,
  Edit,
  SimpleForm,
  TextInput,
  SelectInput,
  Create,
  useRecordContext,
  BooleanField,
  BooleanInput,
  DateField,
  ChipField
} from 'react-admin';

const agentFilters = [
  <TextInput source="q" label="Search" alwaysOn />,
  <SelectInput source="type" label="Type" choices={[
    { id: 'langchain', name: 'LangChain' },
    { id: 'mcp', name: 'MCP' },
    { id: 'custom', name: 'Custom' },
  ]} />,
  <SelectInput source="status" label="Status" choices={[
    { id: 'active', name: 'Active' },
    { id: 'inactive', name: 'Inactive' },
  ]} />
];

const AgentStatusField = ({ record }: { record?: any }) => {
  if (!record) return null;
  return (
    <ChipField
      source="status"
      record={record}
      color={record.status === 'active' ? 'success' : 'default'}
    />
  );
};

export const AgentList = () => (
  <List filters={agentFilters}>
    <Datagrid rowClick="edit">
      <TextField source="id" />
      <TextField source="name" />
      <TextField source="type" />
      <AgentStatusField />
      <DateField source="lastUsed" />
    </Datagrid>
  </List>
);

const AgentTitle = () => {
  const record = useRecordContext();
  return <span>Agent {record ? `"${record.name}"` : ''}</span>;
};

export const AgentEdit = () => (
  <Edit title={<AgentTitle />}>
    <SimpleForm>
      <TextInput source="id" disabled />
      <TextInput source="name" />
      <SelectInput source="type" choices={[
        { id: 'langchain', name: 'LangChain' },
        { id: 'mcp', name: 'MCP' },
        { id: 'custom', name: 'Custom' },
      ]} />
      <SelectInput source="status" choices={[
        { id: 'active', name: 'Active' },
        { id: 'inactive', name: 'Inactive' },
      ]} />
      <TextInput source="endpoint" fullWidth />
      <TextInput source="apiKey" type="password" fullWidth />
      <TextInput source="config" multiline fullWidth />
    </SimpleForm>
  </Edit>
);

export const AgentCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="name" />
      <SelectInput source="type" choices={[
        { id: 'langchain', name: 'LangChain' },
        { id: 'mcp', name: 'MCP' },
        { id: 'custom', name: 'Custom' },
      ]} />
      <SelectInput source="status" choices={[
        { id: 'active', name: 'Active' },
        { id: 'inactive', name: 'Inactive' },
      ]} defaultValue="inactive" />
      <TextInput source="endpoint" fullWidth />
      <TextInput source="apiKey" type="password" fullWidth />
      <TextInput source="config" multiline fullWidth />
    </SimpleForm>
  </Create>
);
