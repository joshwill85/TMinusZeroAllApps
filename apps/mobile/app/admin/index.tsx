import { Redirect, type Href } from 'expo-router';

export default function AdminIndexScreen() {
  return <Redirect href={'/admin/access' as Href} />;
}
