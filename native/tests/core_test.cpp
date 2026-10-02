#include "sidechannel/core.hpp"

#include <cassert>
#include <cmath>

int main() {
  sidechannel::DeterministicSimulator first(1337);
  sidechannel::DeterministicSimulator second(1337);
  const auto first_tick = first.tick(0, 1000);
  const auto second_tick = second.tick(0, 1000);
  assert(first_tick.size() == 9);
  assert(first_tick.size() == second_tick.size());
  for (std::size_t index = 0; index < first_tick.size(); ++index) {
    assert(first_tick[index].id == second_tick[index].id);
    assert(first_tick[index].channel == second_tick[index].channel);
    assert(first_tick[index].value == second_tick[index].value);
    assert(first_tick[index].evidence_state == sidechannel::EvidenceState::simulated);
  }

  sidechannel::AdmissionSequencer sequencer(2);
  assert(sequencer.enqueue(first_tick[0]));
  assert(sequencer.enqueue(first_tick[1]));
  assert(!sequencer.enqueue(first_tick[2]));
  assert(sequencer.pending() == 2);
  const auto admitted = sequencer.drain();
  assert(admitted.size() == 2);
  assert(admitted[0].id == first_tick[0].id);
  assert(admitted[1].id == first_tick[1].id);
  assert(sequencer.receipt().frames_received == 3);
  assert(sequencer.receipt().frames_admitted == 2);
  assert(sequencer.receipt().frames_dropped_backpressure == 1);
  assert(sequencer.receipt().max_depth == 2);
  assert(std::string(sidechannel::to_string(sidechannel::EvidenceState::simulated)) == "simulated");
  return 0;
}
