import { create } from 'zustand';

interface Slide {
  id: string;
  filename: string;
  order: number;
}

interface Presentation {
  id: string;
  name: string;
  slides: Slide[];
}

interface AppState {
  presentations: Presentation[];
  
  // Ações para Apresentações
  setPresentations: (presentations: Presentation[]) => void;
  addPresentation: (presentation: Presentation) => void;
  removePresentation: (id: string) => void;
  updatePresentationName: (id: string, name: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  presentations: [],
  
  setPresentations: (presentations) => set({ presentations }),
  
  addPresentation: (presentation) => 
    set((state) => ({ 
      presentations: [...state.presentations, presentation] 
    })),
  
  removePresentation: (id) =>
    set((state) => ({
      presentations: state.presentations.filter(p => p.id !== id)
    })),
  
  updatePresentationName: (id, name) =>
    set((state) => ({
      presentations: state.presentations.map(p =>
        p.id === id ? { ...p, name } : p
      )
    })),
}));