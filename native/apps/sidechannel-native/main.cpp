#include "sidechannel/core.hpp"

#include <cstdlib>
#include <iostream>

int main(int argc, char** argv) {
  std::size_t ticks = 1;
  if (argc == 3 && std::string(argv[1]) == "--ticks") {
    ticks = static_cast<std::size_t>(std::strtoul(argv[2], nullptr, 10));
  }
  if (ticks == 0 || ticks > 10000) {
    std::cerr << "ticks must be between 1 and 10000\n";
    return 2;
  }

  sidechannel::DeterministicSimulator simulator;
  sidechannel::AdmissionSequencer sequencer(512);
  for (std::size_t tick = 0; tick < ticks; ++tick) {
    for (auto& observation : simulator.tick(tick, static_cast<std::int64_t>(tick) * 250)) {
      sequencer.enqueue(std::move(observation));
    }
  }
  const auto observations = sequencer.drain();
  const auto& receipt = sequencer.receipt();
  std::cout << "protocol=sidechannel.native-reference/0.1\n";
  std::cout << "observations=" << observations.size() << "\n";
  std::cout << "frames_received=" << receipt.frames_received << "\n";
  std::cout << "frames_admitted=" << receipt.frames_admitted << "\n";
  std::cout << "frames_dropped_backpressure=" << receipt.frames_dropped_backpressure << "\n";
  return 0;
}
