import { Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import SuiviVisites from "./components/SuiviVisites";
import BarreOnglets from "./components/BarreOnglets";
import Accueil from "./pages/Accueil";
import Carte from "./pages/Carte";
import Prediction from "./pages/Prediction";
import Analyses from "./pages/Analyses";
import Trajet from "./pages/Trajet";
import Faq from "./pages/Faq";
import Plus from "./pages/Plus";
import Nora from "./pages/Nora";
import Sources from "./pages/Sources";
import Favoris from "./pages/Favoris";
import Bus from "./pages/Bus";

export default function App() {
  return (
    <div className="page">
      <SuiviVisites />
      <Header />

      <main className="conteneur">
        {/* Selon l'adresse, React affiche UNE de ces pages */}
        <Routes>
          <Route path="/" element={<Accueil />} />
          <Route path="/carte" element={<Carte />} />
          <Route path="/prediction" element={<Prediction />} />
          <Route path="/analyses" element={<Analyses />} />
          <Route path="/trajet" element={<Trajet />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/plus" element={<Plus />} />
          <Route path="/nora" element={<Nora />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/favoris" element={<Favoris />} />
          <Route path="/bus" element={<Bus />} />
        </Routes>
      </main>

      <Footer />
      <BarreOnglets />
    </div>
  );
}
