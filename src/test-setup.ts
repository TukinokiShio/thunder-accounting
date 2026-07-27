import '@testing-library/jest-dom';

// Mock ResizeObserver（jsdom 不提供该 API，Recharts ResponsiveContainer 依赖它）
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
