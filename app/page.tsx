import { CampusCoffeeApp } from "../components/campus-coffee-app";
import { cafes, editorialMoments, guideGroups } from "../lib/cafes";

export default function HomePage() {
  return (
    <CampusCoffeeApp
      cafes={cafes}
      editorialMoments={editorialMoments}
      guideGroups={guideGroups}
    />
  );
}
