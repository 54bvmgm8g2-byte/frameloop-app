export type Category = 'people' | 'spaces' | 'nature' | 'hobbies' | 'other';
export type ProgressPhoto = { id: string; uri: string; createdAt: string; note?: string };
export type Project = {
  id: string;
  title: string;
  category: Category;
  reminder: 'daily' | 'weekly' | 'monthly' | 'none';
  createdAt: string;
  photos: ProgressPhoto[];
};
export type Screen =
  | { name: 'home' }
  | { name: 'create' }
  | { name: 'library' }
  | { name: 'project' | 'camera' | 'compare' | 'playback'; projectId: string };
