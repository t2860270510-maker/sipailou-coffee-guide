import { CampusCoffeeApp } from "../components/campus-coffee-app";
import { editorialMoments, guideGroups } from "../lib/cafes";
import { getPublicCoffeeSnapshot } from "../lib/data/service";

export const revalidate = 60;

export default async function HomePage() {
  const snapshot = await getPublicCoffeeSnapshot();
  return (
    <CampusCoffeeApp
      cafes={snapshot.cafes}
      editorialMoments={editorialMoments}
      guideGroups={guideGroups}
    />
  );
}
