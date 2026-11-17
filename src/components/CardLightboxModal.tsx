import React from 'react';
import { X, Trophy, Check } from 'lucide-react';
import type { PlayerProfile } from '../data/awardsData';

interface CardLightboxModalProps {
  player: PlayerProfile | null;
  onClose: () => void;
  onSelectPlayer?: (playerId: string) => void;
  isSelected?: boolean;
  isSelfBlocked?: boolean;
  categoryTitle?: string;
}

export const CardLightboxModal: React.FC<CardLightboxModalProps> = ({
  player,
  onClose,
  onSelectPlayer,
  isSelected,
  isSelfBlocked,
  categoryTitle,
}) => {
  if (!player) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Carta de ${player.name}`}
    >
      <div
        className="relative w-full max-w-md rounded-3xl bg-[#151C28] border border-white/10 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/10">
          <div>
            <h3 className="font-display text-2xl font-bold tracking-wide text-white">
              {player.name}
            </h3>
            <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
              Nível {player.level} <span aria-hidden="true">·</span> {player.archetype}{' '}
              <span aria-hidden="true">·</span> {player.gamertag}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
            aria-label="Fechar visualização"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="my-4 flex flex-col items-center">
          <div className="relative w-full max-w-[290px] aspect-[3/4] rounded-2xl overflow-hidden bg-slate-950 border border-amber-500/30 shadow-xl">
            <img
              src={player.imageUrl}
              alt={`Carta oficial Pro Clubs de ${player.name}`}
              referrerPolicy="no-referrer"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="mt-3 text-center">
            <p className="text-xs text-slate-400 font-mono tabular-nums">
              {player.statsSummary} <span aria-hidden="true">·</span> TOTAL {player.totalStats}
            </p>
          </div>
        </div>

        {onSelectPlayer && (
          <div className="pt-2">
            {isSelfBlocked ? (
              <div className="w-full min-h-[48px] rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-xs font-medium flex items-center justify-center px-4 text-center">
                Auto-voto não permitido pelas regras da premiação
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onSelectPlayer(player.id);
                  onClose();
                }}
                className={`w-full min-h-[48px] rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${
                  isSelected
                    ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                    : 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                }`}
              >
                {isSelected ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Selecionado{categoryTitle ? ` em ${categoryTitle}` : ''}</span>
                  </>
                ) : (
                  <>
                    <Trophy className="w-4 h-4" />
                    <span>Votar em {player.name}</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
