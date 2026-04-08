import React from 'react';
import {
  List,
  Datagrid,
  TextField,
  EmailField,
  Edit,
  SimpleForm,
  TextInput,
  SelectInput,
  Create,
  useRecordContext,
  BooleanField,
  BooleanInput,
  DateField
} from 'react-admin';

const userFilters = [
  <TextInput source="q" label="Search" alwaysOn />,
  <SelectInput source="role" label="Role" choices={[
    { id: 'admin', name: 'Admin' },
    { id: 'user', name: 'User' },
  ]} />
];

export const UserList = () => (
  <List filters={userFilters}>
    <Datagrid rowClick="edit">
      <TextField source="id" />
      <TextField source="username" />
      <EmailField source="email" />
      <TextField source="role" />
      <BooleanField source="isActive" />
      <DateField source="lastLogin" />
    </Datagrid>
  </List>
);

const UserTitle = () => {
  const record = useRecordContext();
  return <span>User {record ? `"${record.username}"` : ''}</span>;
};

export const UserEdit = () => (
  <Edit title={<UserTitle />}>
    <SimpleForm>
      <TextInput source="id" disabled />
      <TextInput source="username" />
      <TextInput source="email" />
      <SelectInput source="role" choices={[
        { id: 'admin', name: 'Admin' },
        { id: 'user', name: 'User' },
      ]} />
      <BooleanInput source="isActive" />
    </SimpleForm>
  </Edit>
);

export const UserCreate = () => (
  <Create>
    <SimpleForm>
      <TextInput source="username" />
      <TextInput source="email" />
      <TextInput source="password" type="password" />
      <SelectInput source="role" choices={[
        { id: 'admin', name: 'Admin' },
        { id: 'user', name: 'User' },
      ]} />
      <BooleanInput source="isActive" defaultValue={true} />
    </SimpleForm>
  </Create>
);
