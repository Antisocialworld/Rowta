// COMPONENT KIT barrel — the only import surface screens use (rules U5, U8).
// Every component documents its variants, states and props in its own file header; every visible word comes from
// app/src/i18n/en.ts through t(); every value comes from app/src/theme/tokens.ts.
export { Text, type TextProps, type TextTone } from './Text';
export { Button, type ButtonProps, type ButtonVariant } from './Button';
export { LinkButton, type LinkButtonProps } from './LinkButton';
export { Input, type InputProps, type InputVariant } from './Input';
export { Card, type CardProps } from './Card';
export { ShiftCard, type ShiftCardProps, type ShiftCardData } from './ShiftCard';
export { Badge, type BadgeProps, type BadgeTone } from './Badge';
export { Chip, type ChipProps } from './Chip';
export { Avatar, type AvatarProps, type AvatarSize } from './Avatar';
export { Skeleton, type SkeletonProps, type SkeletonVariant } from './Skeleton';
export { EmptyState, type EmptyStateProps, type EmptyStateKind } from './EmptyState';
export { Toast, type ToastProps, type ToastTone } from './Toast';
export { BottomSheet, type BottomSheetProps } from './BottomSheet';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export { LiveRegion, type LiveRegionProps } from './LiveRegion';
