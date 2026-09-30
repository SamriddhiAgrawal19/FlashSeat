import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['ATTENDEE', 'ORGANIZER']).default('ATTENDEE'),
  organization_name: z.string().optional(),
}).refine(data => {
  if (data.role === 'ORGANIZER' && !data.organization_name) {
    return false;
  }
  return true;
}, {
  message: 'organization_name is required when role is ORGANIZER',
  path: ['organization_name']
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required')
});

export type RegisterRequest = z.infer<typeof registerSchema>;
export type LoginRequest = z.infer<typeof loginSchema>;
