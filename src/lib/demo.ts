import type { OpenMicWithVenue, Venue } from '../types'

// Sample listings for local UI work ONLY (VITE_DEMO_DATA=1 in a dev build).
// Venues and events are invented; they are never loaded in a production build.
const v = (id: string, name: string, city: string, lat: number, lng: number): Venue => ({
  id, name, address: '1 Example St', city, region: 'NJ', country: 'US', locationHidden: false, lat, lng,
  timezone: 'America/New_York', status: 'approved', createdAt: '2026-01-01T00:00:00Z',
})

const venues = [
  v('v1', 'DEMO The Example Tavern', 'Hackensack', 40.8859, -74.0435),
  v('v2', 'DEMO Sample Coffeehouse', 'Teaneck', 40.8976, -74.0160),
  v('v3', 'DEMO Placeholder Pub', 'Hoboken', 40.744, -74.0324),
]

const mic = (id: string, venue: Venue, p: Partial<OpenMicWithVenue>): OpenMicWithVenue => ({
  id, venueId: venue.id, venue, title: 'DEMO Open Mic', format: 'music', genres: [], dayOfWeek: 2,
  weeksOfMonth: [], startTime: '19:00', signupMethod: 'list_at_door', ageRestriction: 'all_ages',
  status: 'approved', createdAt: '2026-01-01T00:00:00Z',
  lastVerifiedAt: new Date(Date.now() - 20 * 86_400_000).toISOString(), ...p,
})

export const DEMO_MICS: OpenMicWithVenue[] = [
  mic('m1', venues[0], { title: 'DEMO Tuesday Acoustic Night', dayOfWeek: 2, genres: ['Folk / Acoustic'], hostName: 'Demo Host', houseGear: 'PA, 2 mics', signupTime: '18:30' }),
  mic('m2', venues[0], { title: 'DEMO Comedy Showcase', format: 'comedy', dayOfWeek: 4, weeksOfMonth: [1, 3], startTime: '20:00', ageRestriction: '21_plus' }),
  mic('m3', venues[1], { title: 'DEMO Poetry & Songs', format: 'poetry', dayOfWeek: 0, startTime: '16:00', lastVerifiedAt: undefined }),
  mic('m4', venues[2], { title: 'DEMO Rock Jam', dayOfWeek: 5, weeksOfMonth: [-1], genres: ['Rock', 'Blues'], startTime: '21:00', costNote: 'Free' }),
]
