import { Project, ProjectStatus } from '@/types/project';

const STORAGE_KEY = 'ai-comic-studio-projects';

export class StorageService {
  // 获取所有项目
  static getProjects(): Project[] {
    if (typeof window === 'undefined') return [];

    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Failed to load projects:', error);
      return [];
    }
  }

  // 获取单个项目
  static getProject(id: string): Project | null {
    const projects = this.getProjects();
    return projects.find(p => p.id === id) || null;
  }

  // 保存项目
  static saveProject(project: Project): void {
    const projects = this.getProjects();
    const index = projects.findIndex(p => p.id === project.id);

    if (index >= 0) {
      projects[index] = project;
    } else {
      projects.push(project);
    }

    this.saveProjects(projects);
  }

  // 删除项目
  static deleteProject(id: string): void {
    const projects = this.getProjects();
    const filtered = projects.filter(p => p.id !== id);
    this.saveProjects(filtered);
  }

  // 更新项目状态
  static updateProjectStatus(id: string, status: ProjectStatus): void {
    const project = this.getProject(id);
    if (project) {
      project.status = status;
      project.updatedAt = new Date().toISOString();
      this.saveProject(project);
    }
  }

  // 保存所有项目
  private static saveProjects(projects: Project[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    } catch (error) {
      console.error('Failed to save projects:', error);
    }
  }

  // 导出项目数据
  static exportProjects(): string {
    const projects = this.getProjects();
    return JSON.stringify(projects, null, 2);
  }

  // 导入项目数据
  static importProjects(data: string): boolean {
    try {
      const projects = JSON.parse(data);
      if (Array.isArray(projects)) {
        this.saveProjects(projects);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to import projects:', error);
      return false;
    }
  }

  // 清空所有数据
  static clearAll(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  // 获取存储统计
  static getStats() {
    const projects = this.getProjects();
    return {
      total: projects.length,
      completed: projects.filter(p => p.status === 'completed').length,
      inProgress: projects.filter(p => p.status === 'in-progress').length,
      failed: projects.filter(p => p.status === 'failed').length,
    };
  }
}
