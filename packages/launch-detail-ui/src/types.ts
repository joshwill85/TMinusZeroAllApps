/**
 * Platform-agnostic types for launch detail UI components
 */

export type LaunchTab = 'overview' | 'live' | 'mission' | 'vehicle' | 'related';

export interface TabDefinition {
  id: LaunchTab;
  label: string;
  icon?: string;
  badge?: boolean;
}

export interface TabVisibility {
  overview: boolean;
  live: boolean;
  mission: boolean;
  vehicle: boolean;
  related: boolean;
}

export interface PrimitiveComponentProps {
  className?: string;
  style?: React.CSSProperties | Record<string, any>;
  children?: React.ReactNode;
}

export interface CardProps extends PrimitiveComponentProps {
  variant?: 'default' | 'elevated' | 'outlined';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export interface StatTileProps extends PrimitiveComponentProps {
  label: string;
  value: string | number;
  icon?: string;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  compact?: boolean;
}

export interface InfoGridProps extends PrimitiveComponentProps {
  items: Array<{
    label: string;
    value: string | number | null | undefined;
    link?: string;
  }>;
  columns?: 1 | 2 | 3;
}

export interface BadgeProps extends PrimitiveComponentProps {
  label: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md' | 'lg';
}
