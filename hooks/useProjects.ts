// 项目数据 Hook
import { useState, useEffect } from 'react';
import { Project } from '@/types/project';
import { StorageService } from '@/services/storage.service';

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = () => {
    setLoading(true);
    const data = StorageService.getProjects();
    setProjects(data);
    setLoading(false);
  };

  const addProject = (project: Project) => {
    StorageService.saveProject(project);
    loadProjects();
  };

  const updateProject = (project: Project) => {
    StorageService.saveProject(project);
    loadProjects();
  };

  const deleteProject = (id: string) => {
    StorageService.deleteProject(id);
    loadProjects();
  };

  return {
    projects,
    loading,
    addProject,
    updateProject,
    deleteProject,
    refresh: loadProjects
  };
}

export function useProject(id: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const data = StorageService.getProject(id);
    setProject(data);
    setLoading(false);
  }, [id]);

  const updateProject = (updates: Partial<Project>) => {
    if (project) {
      const updated = { ...project, ...updates };
      StorageService.saveProject(updated);
      setProject(updated);
    }
  };

  return {
    project,
    loading,
    updateProject
  };
}
