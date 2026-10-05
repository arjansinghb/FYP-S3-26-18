import { BookIcon, CompassIcon, FlaskIcon, MoonIcon, PawIcon, SparkleIcon } from '../icons'

const GENRE_ICONS = {
  animals: PawIcon, nature: PawIcon,
  adventure: CompassIcon, dinosaur: CompassIcon, mystery: CompassIcon, space: CompassIcon,
  cosy: MoonIcon, calming: MoonIcon,
  science: FlaskIcon,
  funny: SparkleIcon, humor: SparkleIcon,
}

export function iconForGenre(genre) {
  return GENRE_ICONS[genre.toLowerCase()] || BookIcon
}
