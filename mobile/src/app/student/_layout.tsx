import { Tabs } from 'expo-router';
import React from 'react';

import { tabIcon as icon } from '../../ui/tabIcon';
import { colors } from '../../ui/theme';


export default function StudentTabs() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerTitleStyle: { color: colors.text } }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: icon('◉') }} />
      <Tabs.Screen name="courses" options={{ title: 'My Courses', tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance', tabBarIcon: icon('✓') }} />
      <Tabs.Screen name="photos" options={{ title: 'Face Photos', tabBarIcon: icon('◎') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('☰') }} />
    </Tabs>
  );
}
