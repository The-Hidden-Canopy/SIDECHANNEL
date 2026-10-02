#pragma once

#include "sidechannel/core.hpp"

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

struct sqlite3;

namespace sidechannel {

class NativeSqliteSessionStore {
public:
  NativeSqliteSessionStore(std::filesystem::path file_path, std::string session_id);
  ~NativeSqliteSessionStore();

  NativeSqliteSessionStore(const NativeSqliteSessionStore&) = delete;
  NativeSqliteSessionStore& operator=(const NativeSqliteSessionStore&) = delete;

  bool open();
  bool append(Observation observation);
  bool record_event(std::string type, std::int64_t timestamp_ms, std::string payload);
  bool close(std::int64_t ended_at_ms);
  [[nodiscard]] const std::string& state() const noexcept;
  [[nodiscard]] const std::vector<Observation>& observations() const noexcept;
  [[nodiscard]] const std::vector<JournalEntry>& journal() const noexcept;
  [[nodiscard]] JournalVerification verify() const;
  [[nodiscard]] std::string export_json() const;
  [[nodiscard]] const std::string& last_error() const noexcept;

private:
  bool execute(const char* sql);
  bool ensure_schema();
  bool load_rows();
  bool insert_journal(const JournalEntry& entry);
  bool insert_observation(const Observation& observation);
  bool update_session_state(const std::string& state, std::optional<std::int64_t> ended_at_ms);
  JournalEntry next_event(std::string type, std::int64_t timestamp_ms, std::string payload) const;
  void set_error(const std::string& message) const;
  void close_database();

  std::filesystem::path file_path_;
  std::string session_id_;
  ::sqlite3* database_ = nullptr;
  std::vector<JournalEntry> journal_entries_;
  std::vector<Observation> observations_;
  std::string state_ = "closed";
  mutable std::string last_error_;
};

} // namespace sidechannel
