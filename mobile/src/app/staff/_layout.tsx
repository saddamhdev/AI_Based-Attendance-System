import { Tabs } from 'expo-router';
import React from 'react';

import { useMe } from '../../auth/AuthProvider';
import { tabIcon as icon } from '../../ui/tabIcon';
import { colors } from '../../ui/theme';

/** Teachers and administrators share this area; admin-only tabs are hidden for teachers (and enforced by the API). */
export default function StaffTabs() {
  const me = useMe();
  const isAdmin = me.role === 'ADMIN';
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerTitleStyle: { color: colors.text } }}>
      <Tabs.Screen name="index" options={{ title: isAdmin ? 'Dashboard' : 'My Offerings', tabBarIcon: icon('◉') }} />
      <Tabs.Screen name="sessions" options={{ title: 'Sessions', tabBarIcon: icon('✓') }} />
      <Tabs.Screen name="students" options={{ title: 'Students', tabBarIcon: icon('☺'), href: isAdmin ? undefined : null }} />
      <Tabs.Screen name="reviews" options={{ title: 'Reviews', tabBarIcon: icon('◎'), href: isAdmin ? undefined : null }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('☰') }} />
    </Tabs>
  );
}
