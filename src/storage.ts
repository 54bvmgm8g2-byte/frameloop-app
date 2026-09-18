import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Project } from './types';

const KEY = '@frameloop/projects/v1';
export async function loadProjects(): Promise<Project[]> {
  try { return JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'); } catch { return []; }
}
export async function saveProjects(projects: Project[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(projects));
}
export async function persistImage(source: string) {
  const dir = `${FileSystem.documentDirectory}frameloop/`;
  if (!(await FileSystem.getInfoAsync(dir)).exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const target = `${dir}${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  await FileSystem.copyAsync({ from: source, to: target });
  return target;
}
