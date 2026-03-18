// Упрощённый вариант без модулей/JSX.
// React, ReactDOM и Supabase подключены в index.html как UMD-бандлы.

(function () {
  var useState = React.useState;
  var useEffect = React.useEffect;
  var createClient = window.supabase.createClient;

  var SUPABASE_URL = "https://ervtmgbehtwdscvbnvio.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_tsxpOnKQfOhO5yIbUJ0klw_up62oSJo";

  var supabase =
    SUPABASE_URL && SUPABASE_ANON_KEY
      ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;

  // Нормализация и валидация телефона: +7 и 10 цифр, без пробелов и символов.
  // Пустое поле — допустимо (необязательное). Возвращает { valid, normalized }.
  function normalizePhoneForRussia(raw) {
    var s = (raw || "").trim();
    if (!s) return { valid: true, normalized: null };
    var digits = s.replace(/\D/g, "");
    if (digits.length === 11 && (digits[0] === "8" || digits[0] === "7")) {
      return { valid: true, normalized: "+7" + digits.slice(1) };
    }
    if (digits.length === 10 && digits[0] !== "0") {
      return { valid: true, normalized: "+7" + digits };
    }
    return { valid: false, normalized: null };
  }

  // ---------- ХУК АВТОРИЗАЦИИ ----------

  function useAuth() {
    var sessionState = useState(null);
    var session = sessionState[0];
    var setSession = sessionState[1];

    var employeeState = useState(null);
    var employee = employeeState[0];
    var setEmployee = employeeState[1];

    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    useEffect(function () {
      if (!supabase) {
        setLoading(false);
        setError("Supabase не инициализирован.");
        return;
      }

      var isMounted = true;

      function init() {
        supabase.auth
          .getSession()
          .then(function (result) {
            if (!isMounted) return;

            if (result.error) {
              console.error(result.error);
              setError("Не удалось инициализировать авторизацию.");
              setLoading(false);
              return;
            }

            var initialSession = result.data.session;
            if (initialSession && initialSession.user) {
              fetchEmployeeForUser(initialSession.user).then(function (emp) {
                if (!isMounted) return;
                if (emp && emp.is_active) {
                  setSession(initialSession);
                  setEmployee(emp);
                }
                setLoading(false);
              });
            } else {
              setLoading(false);
            }
          })
          .catch(function (e) {
            console.error(e);
            if (isMounted) {
              setError("Ошибка инициализации авторизации.");
              setLoading(false);
            }
          });
      }

      init();

      var authSubscription = supabase.auth.onAuthStateChange(
        function (event, newSession) {
          if (!isMounted) return;

          if (event === "SIGNED_IN" && newSession && newSession.user) {
            fetchEmployeeForUser(newSession.user).then(function (emp) {
              if (emp && emp.is_active) {
                setSession(newSession);
                setEmployee(emp);
                setError(null);
              } else {
                setError("Доступ запрещён. Обратитесь к администратору.");
                supabase.auth.signOut();
                setSession(null);
                setEmployee(null);
              }
            });
          }

          if (event === "SIGNED_OUT") {
            setSession(null);
            setEmployee(null);
          }
        }
      );

      return function () {
        isMounted = false;
        try {
          authSubscription.data.subscription.unsubscribe();
        } catch (e) {}
      };
    }, []);

    function fetchEmployeeForUser(user, autoBindTelegramId) {
      if (!supabase || !user) return Promise.resolve(null);
      return supabase
        .from("employees")
        .select("id, first_name, last_name, is_active, tg_id, role")
        .eq("auth_user_id", user.id)
        .maybeSingle()
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось загрузить данные сотрудника.");
            return null;
          }
          var emp = result.data;
          
          // Автоматическая привязка Telegram ID при входе из Telegram WebApp
          if (emp && autoBindTelegramId && !emp.tg_id) {
            // Сначала проверяем, не привязан ли уже этот Telegram ID к другому пользователю
            return supabase
              .from("employees")
              .select("id, first_name, last_name, email")
              .eq("tg_id", String(autoBindTelegramId))
              .eq("is_active", true)
              .maybeSingle()
              .then(function (checkResult) {
                if (checkResult.data) {
                  // Telegram уже привязан к другому пользователю
                  var otherUser = checkResult.data;
                  var otherUserName = otherUser.first_name 
                    ? (otherUser.first_name + " " + (otherUser.last_name || "")).trim()
                    : otherUser.email;
                  
                  setError(
                    "⚠️ Этот Telegram аккаунт уже привязан к другому пользователю (" + otherUserName + "). " +
                    "Сначала отвяжите его в веб-приложении или обратитесь к администратору."
                  );
                  return emp; // Возвращаем сотрудника без привязки
                }
                
                // Telegram ID свободен, привязываем
                return supabase
                  .from("employees")
                  .update({ tg_id: String(autoBindTelegramId) })
                  .eq("id", emp.id)
                  .then(function (upd) {
                    if (!upd.error) {
                      emp.tg_id = String(autoBindTelegramId);
                      console.log("✅ Telegram ID автоматически привязан:", autoBindTelegramId);
                    } else {
                      console.error("❌ Ошибка привязки Telegram:", upd.error);
                    }
                    return emp;
                  });
              });
          }
          
          return emp;
        });
    }

    function login(email, password) {
      if (!supabase) {
        setError("Supabase не инициализирован.");
        return Promise.resolve();
      }
      setError(null);

      var telegramId = null;
      if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe && window.Telegram.WebApp.initDataUnsafe.user) {
        telegramId = window.Telegram.WebApp.initDataUnsafe.user.id;
      }

      return supabase.auth
        .signInWithPassword({ email: email, password: password })
        .then(function (result) {
          if (result.error || !result.data.session || !result.data.session.user) {
            console.error(result.error);
            setError("Не удалось войти. Проверьте email и пароль.");
            return;
          }

          var newSession = result.data.session;
          return fetchEmployeeForUser(newSession.user, telegramId).then(function (emp) {
            if (emp && emp.is_active) {
              setSession(newSession);
              setEmployee(emp);
            } else {
              setError("Доступ запрещён. Обратитесь к администратору.");
              supabase.auth.signOut();
              setSession(null);
              setEmployee(null);
            }
          });
        });
    }

    function logout() {
      if (supabase) {
        supabase.auth.signOut().catch(function (e) {
          console.error(e);
        });
      }
      setSession(null);
      setEmployee(null);
    }

    return {
      session: session,
      employee: employee,
      loading: loading,
      error: error,
      login: login,
      logout: logout,
      supabaseReady: !!supabase,
    };
  }

  // ---------- КОМПОНЕНТЫ ----------

  function LoginForm(props) {
    var emailState = useState("");
    var email = emailState[0];
    var setEmail = emailState[1];

    var passwordState = useState("");
    var password = passwordState[0];
    var setPassword = passwordState[1];

    var submittingState = useState(false);
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];

    var disabled = !props.supabaseReady || props.loading || submitting;

    function onSubmit(e) {
      e.preventDefault();
      if (disabled) return;
      setSubmitting(true);
      props.onLogin(email.trim(), password).finally(function () {
        setSubmitting(false);
      });
    }

    return React.createElement(
      "div",
      { className: "panel" },
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "panel-title" },
            "Вход в систему"
          ),
          React.createElement(
            "div",
            { className: "panel-subtitle" },
            "Доступ только для сотрудников компании."
          )
        ),
        React.createElement("span", { className: "badge" }, "Блок 01 — Авторизация")
      ),
      React.createElement(
        "p",
        { className: "panel-tagline" },
        "Введите корпоративный email и пароль. После успешного входа система проверит, что сотрудник активен."
      ),
      React.createElement("div", { className: "divider" }),
      React.createElement(
        "form",
        { className: "form", onSubmit: onSubmit },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Email сотрудника",
            React.createElement("span", null, "*")
          ),
          React.createElement("input", {
            className: "input",
            type: "email",
            required: true,
            placeholder: "user@company.ru",
            value: email,
            onChange: function (e) {
              setEmail(e.target.value);
            },
            disabled: disabled,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Пароль",
            React.createElement("span", null, "*")
          ),
          React.createElement("input", {
            className: "input",
            type: "password",
            required: true,
            placeholder: "Введите пароль",
            value: password,
            onChange: function (e) {
              setPassword(e.target.value);
            },
            disabled: disabled,
          })
        ),
        React.createElement(
          "button",
          { className: "button", type: "submit", disabled: disabled },
          submitting || props.loading ? "Вход..." : "Войти"
        )
      ),
      props.error &&
        React.createElement(
          "div",
          { className: "alert alert-error" },
          React.createElement("div", { className: "alert-icon" }, "!"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement(
              "div",
              { className: "alert-title" },
              "Ошибка авторизации"
            ),
            React.createElement("div", { className: "alert-text" }, props.error)
          )
        )
    );
  }

  // ---------- КОМПОНЕНТ ПЛИТКИ ----------

  function MenuTile(props) {
    return React.createElement(
      "div",
      {
        className: "menu-tile" + (props.primary ? " primary" : ""),
        onClick: props.onClick,
      },
      React.createElement(
        "div",
        { className: "menu-tile-icon" },
        props.icon || "📋"
      ),
      React.createElement(
        "div",
        { className: "menu-tile-title" },
        props.title
      ),
      React.createElement(
        "div",
        { className: "menu-tile-description" },
        props.description
      )
    );
  }

  // ---------- ГЛАВНОЕ МЕНЮ ----------

  function MainMenu(props) {
    var tgLinked = !!props.employee.tg_id;
    var role = props.employee.role || "user";
    var roleLabel = role === "owner" ? "Владелец" : "Пользователь";

    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { style: { marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid rgba(148, 163, 184, 0.2)" } },
        React.createElement(
          "div",
          { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" } },
          React.createElement(
            "div",
            { className: "top-bar-user" },
            "Сотрудник: ",
            React.createElement(
              "strong",
              null,
              props.employee.first_name || "Не указано",
              " ",
              props.employee.last_name || ""
            ),
            " ",
            React.createElement(
              "span",
              { style: { fontSize: "11px", color: "var(--text-muted)", fontWeight: "normal" } },
              "(",
              roleLabel,
              ")"
            )
          ),
          React.createElement(
            "button",
            {
              className: "button-ghost",
              type: "button",
              onClick: props.onLogout,
            },
            "Выйти"
          )
        ),
        React.createElement(
          "div",
          { style: { display: "flex", justifyContent: "flex-start" } },
          React.createElement(
            "button",
            {
              className: "button-ghost",
              type: "button",
              onClick: function () {
                props.onNavigate("telegram");
              },
              style: {
                background: tgLinked ? "transparent" : "linear-gradient(135deg, #dc2626, #991b1b)",
                borderColor: tgLinked ? "rgba(59, 130, 246, 0.9)" : "rgba(220, 38, 38, 0.9)",
                borderWidth: "1px",
                borderStyle: "solid",
                color: tgLinked ? "rgba(59, 130, 246, 1)" : "#ffffff",
                fontSize: "11px",
                padding: "4px 10px",
                height: "28px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                cursor: "pointer",
                pointerEvents: "auto",
              }
            },
            !tgLinked && React.createElement(
              "span",
              {
                style: {
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "#ffffff",
                  display: "inline-block"
                }
              }
            ),
            tgLinked ? "📱 Telegram подключён" : "📱 Подключить Telegram"
          )
        )
      ),
      React.createElement(
        "div",
        { className: "menu-grid" },
        React.createElement(MenuTile, {
          primary: true,
          icon: "📊",
          title: "Внести показания",
          description: "Поиск объекта и ввод показаний счётчиков",
          onClick: function () {
            props.onNavigate("readings");
          },
        }),
        role === "owner" && React.createElement(MenuTile, {
          icon: "🏢",
          title: "Создать объект",
          description: "Добавить новый объект учёта в систему",
          onClick: function () {
            props.onNavigate("create-object");
          },
        }),
        role === "owner" && React.createElement(MenuTile, {
          icon: "✏️",
          title: "Редактировать объект",
          description: "Изменить данные объекта и показания счётчиков",
          onClick: function () {
            props.onNavigate("edit-object");
          },
        }),
        React.createElement(MenuTile, {
          icon: "📈",
          title: "Статистика",
          description: "Таблица показаний счётчиков по месяцам",
          onClick: function () {
            props.onNavigate("stats");
          },
        }),
        role === "owner" && React.createElement(MenuTile, {
          icon: "🏭",
          title: "Операторы",
          description: "Просмотр объектов по обслуживающим организациям",
          onClick: function () {
            props.onNavigate("operators");
          },
        }),
        role === "owner" && React.createElement(MenuTile, {
          icon: "📦",
          title: "Архив",
          description: "Объекты и пользователи — восстановление из архива",
          onClick: function () {
            props.onNavigate("archive");
          },
        }),
        role === "owner" && React.createElement(MenuTile, {
          icon: "👥",
          title: "Управление пользователями",
          description: "Создание учётных записей и назначение ролей",
          onClick: function () {
            props.onNavigate("users");
          },
        })
      )
    );
  }

  // ---------- ЭКРАНЫ-ЗАГЛУШКИ ----------

  function ReadingsScreen(props) {
    var searchQueryState = useState("");
    var searchQuery = searchQueryState[0];
    var setSearchQuery = searchQueryState[1];

    var objectsState = useState([]);
    var objects = objectsState[0];
    var setObjects = objectsState[1];

    var selectedObjectState = useState(null);
    var selectedObject = selectedObjectState[0];
    var setSelectedObject = selectedObjectState[1];

    var countersState = useState([]);
    var counters = countersState[0];
    var setCounters = countersState[1];

    var readingDateState = useState("");
    var readingDate = readingDateState[0];
    var setReadingDate = readingDateState[1];

    var indicationsState = useState({});
    var indications = indicationsState[0];
    var setIndications = indicationsState[1];

    var searchingState = useState(false);
    var searching = searchingState[0];
    var setSearching = searchingState[1];

    var submittingState = useState(false);
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    var successState = useState(false);
    var success = successState[0];
    var setSuccess = successState[1];

    useEffect(function () {
      loadAllObjects();
    }, []);

    function loadAllObjects() {
      setSearching(true);
      setError(null);

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка загрузки объектов");
            setSearching(false);
            return;
          }

          var sorted = result.data.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке объектов");
          setSearching(false);
        });
    }

    function handleSearch() {
      if (!searchQuery.trim()) {
        loadAllObjects();
        return;
      }

      setSearching(true);
      setError(null);
      setSelectedObject(null);

      var query = searchQuery.trim().toLowerCase();

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка поиска объектов");
            setSearching(false);
            return;
          }

          var filtered = result.data.filter(function (obj) {
            var name = (obj.object_name || "").toLowerCase();
            var address = (obj.object_address || "").toLowerCase();
            return name.indexOf(query) !== -1 || address.indexOf(query) !== -1;
          });

          var sorted = filtered.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);

          if (sorted.length === 0) {
            setError("Объекты не найдены. Попробуйте изменить запрос.");
          }
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при поиске объектов");
          setSearching(false);
        });
    }

    function handleSelectObject(obj) {
      setSelectedObject(obj);
      setError(null);
      setSuccess(false);
      setIndications({});

      var today = new Date();
      var yyyy = today.getFullYear();
      var mm = String(today.getMonth() + 1).padStart(2, "0");
      var dd = String(today.getDate()).padStart(2, "0");
      setReadingDate(yyyy + "-" + mm + "-" + dd);

      supabase
        .from("counters")
        .select("*")
        .eq("object_id", obj.id)
        .eq("is_active", true)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось загрузить счётчики объекта");
            return;
          }

          var list = result.data || [];

          // Сортируем счётчики по порядку типов из таблицы counter_types
          if (props.counterTypes && props.counterTypes.length) {
            var orderMap = {};
            for (var i = 0; i < props.counterTypes.length; i++) {
              orderMap[props.counterTypes[i]] = i;
            }
            list.sort(function (a, b) {
              var ia = Object.prototype.hasOwnProperty.call(orderMap, a.counter_type)
                ? orderMap[a.counter_type]
                : 9999;
              var ib = Object.prototype.hasOwnProperty.call(orderMap, b.counter_type)
                ? orderMap[b.counter_type]
                : 9999;
              if (ia !== ib) return ia - ib;
              var nameA = (a.counter_type || "").toLowerCase();
              var nameB = (b.counter_type || "").toLowerCase();
              if (nameA < nameB) return -1;
              if (nameA > nameB) return 1;
              return 0;
            });
          }

          setCounters(list);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке счётчиков");
        });
    }

    function handleIndicationChange(counterId, value) {
      var updated = {};
      for (var key in indications) {
        updated[key] = indications[key];
      }
      updated[counterId] = value;
      setIndications(updated);
    }

    function handleSubmitReadings(e) {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!readingDate) {
        setError("Выберите дату показаний");
        return;
      }

      var readingsToInsert = [];
      for (var i = 0; i < counters.length; i++) {
        var counter = counters[i];
        var value = indications[counter.id];
        if (value && value.trim()) {
          readingsToInsert.push({
            counter_id: counter.id,
            indication: parseFloat(value),
            reading_date: readingDate,
            submitted_by_employee_id: props.employee.id,
          });
        }
      }

      if (readingsToInsert.length === 0) {
        setError("Введите хотя бы одно показание");
        return;
      }

      setSubmitting(true);

      // Проверяем, есть ли уже показания за этот месяц для любого из счётчиков
      var monthStart = readingDate.substring(0, 7) + "-01"; // YYYY-MM-01
      var dateParts = readingDate.substring(0, 7).split("-");
      var nextMonthNum = parseInt(dateParts[1]) === 12 ? 1 : parseInt(dateParts[1]) + 1;
      var nextYearNum = parseInt(dateParts[1]) === 12 ? parseInt(dateParts[0]) + 1 : parseInt(dateParts[0]);
      var monthEnd = nextYearNum + "-" + String(nextMonthNum).padStart(2, "0") + "-01";
      var counterIdsToCheck = readingsToInsert.map(function(r) { return r.counter_id; });

      supabase
        .from("meter_readings")
        .select("counter_id")
        .in("counter_id", counterIdsToCheck)
        .gte("reading_date", monthStart)
        .lt("reading_date", monthEnd)
        .then(function(checkResult) {
          if (checkResult.error) {
            setError("Ошибка при проверке дублей: " + checkResult.error.message);
            setSubmitting(false);
            return;
          }

          if (checkResult.data && checkResult.data.length > 0) {
            // Найдём названия счётчиков с дублями
            var dupIds = {};
            for (var d = 0; d < checkResult.data.length; d++) {
              dupIds[checkResult.data[d].counter_id] = true;
            }
            var dupNames = [];
            for (var c = 0; c < counters.length; c++) {
              if (dupIds[counters[c].id]) {
                dupNames.push(counters[c].counter_type + (counters[c].counter_number ? " № " + counters[c].counter_number : ""));
              }
            }
            var monthLabel = readingDate.substring(0, 7);
            setError("Показания за " + monthLabel + " уже внесены для: " + dupNames.join(", "));
            setSubmitting(false);
            return;
          }

          // Дублей нет — сохраняем
          doInsertReadings();
        })
        .catch(function(err) {
          console.error(err);
          setError("Ошибка при проверке показаний");
          setSubmitting(false);
        });

      function doInsertReadings() {
      supabase
        .from("meter_readings")
        .insert(readingsToInsert)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            if (
              result.error.message &&
              result.error.message.indexOf("duplicate") !== -1
            ) {
              setError(
                "Показания на эту дату уже существуют для одного из счётчиков"
              );
            } else {
              setError("Ошибка при сохранении показаний: " + result.error.message);
            }
            setSubmitting(false);
            return;
          }

          setSuccess(true);
          setSubmitting(false);
          setIndications({});
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при сохранении показаний");
          setSubmitting(false);
        });
      } // end doInsertReadings
    }

    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { className: "top-bar" },
        React.createElement(
          "button",
          {
            className: "back-button",
            onClick: function () {
              props.onNavigate("menu");
            },
          },
          "← Назад в меню"
        )
      ),
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "panel-title" },
            "Внести показания"
          ),
          React.createElement(
            "div",
            { className: "panel-subtitle" },
            selectedObject
              ? selectedObject.object_name
              : "Поиск объекта и ввод показаний счётчиков"
          )
        ),
        React.createElement("span", { className: "badge" }, "Блок 03")
      ),
      React.createElement("div", { className: "divider" }),
      !selectedObject
        ? React.createElement(
            "div",
            null,
            searching && objects.length === 0 && !error &&
              React.createElement(
                "div",
                { className: "hint", style: { marginBottom: "12px" } },
                "⏳ Загрузка объектов..."
              ),
            React.createElement(
              "div",
              { className: "field-label" },
              "Поиск объекта"
            ),
            React.createElement(
              "div",
              { className: "hint", style: { marginBottom: "8px" } },
              "Введите название или адрес для поиска, или оставьте пустым для отображения всех объектов"
            ),
            React.createElement(
              "div",
              { style: { display: "flex", gap: "8px" } },
              React.createElement("input", {
                className: "input",
                type: "text",
                placeholder: "Поиск по названию или адресу",
                value: searchQuery,
                onChange: function (e) {
                  setSearchQuery(e.target.value);
                },
                onKeyPress: function (e) {
                  if (e.key === "Enter") {
                    handleSearch();
                  }
                },
                disabled: searching,
              }),
              React.createElement(
                "button",
                {
                  className: "button",
                  type: "button",
                  onClick: handleSearch,
                  disabled: searching,
                  style: { marginTop: 0 },
                },
                searching ? "Поиск..." : searchQuery.trim() ? "Найти" : "Обновить"
              ),
              searchQuery.trim() && React.createElement(
                "button",
                {
                  className: "button-secondary button",
                  type: "button",
                  onClick: function () {
                    setSearchQuery("");
                    loadAllObjects();
                  },
                  disabled: searching,
                  style: { marginTop: 0 },
                },
                "Очистить"
              )
            ),
            objects.length > 0 &&
              React.createElement(
                "div",
                { style: { marginTop: "16px" } },
                React.createElement(
                  "div",
                  { className: "field-label" },
                  searchQuery.trim() 
                    ? "Найдено объектов: " + objects.length
                    : "Активных объектов: " + objects.length + " (отсортированы по алфавиту)"
                ),
                React.createElement(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                  objects.map(function (obj) {
                    return React.createElement(
                      "div",
                      {
                        key: obj.id,
                        className: "user-card",
                        onClick: function () {
                          handleSelectObject(obj);
                        },
                        style: { cursor: "pointer" },
                      },
                      React.createElement(
                        "div",
                        { className: "user-card-main" },
                        React.createElement(
                          "div",
                          { className: "user-meta" },
                          React.createElement(
                            "div",
                            { className: "user-name" },
                            obj.object_name
                          ),
                          React.createElement(
                            "div",
                            { className: "user-role" },
                            obj.object_address
                          )
                        )
                      ),
                      React.createElement(
                        "button",
                        {
                          className: "button-ghost",
                          type: "button",
                        },
                        "Выбрать →"
                      )
                    );
                  })
                )
              )
          )
        : React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { style: { marginBottom: "16px" } },
              React.createElement(
                "div",
                { className: "user-card" },
                React.createElement(
                  "div",
                  { className: "user-card-main" },
                  React.createElement(
                    "div",
                    { className: "user-meta" },
                    React.createElement(
                      "div",
                      { className: "user-name" },
                      selectedObject.object_name
                    ),
                    React.createElement(
                      "div",
                      { className: "user-role" },
                      selectedObject.object_address
                    ),
                    selectedObject.area &&
                      React.createElement(
                        "div",
                        { className: "user-role" },
                        "Площадь: ",
                        selectedObject.area,
                        " м²"
                      ),
                    selectedObject.contacts &&
                      React.createElement(
                        "div",
                        { className: "user-role" },
                        "Контакты: ",
                        selectedObject.contacts
                      )
                  )
                ),
                React.createElement(
                  "button",
                  {
                    className: "button-ghost",
                    type: "button",
                    onClick: function () {
                      setSelectedObject(null);
                      setCounters([]);
                      setIndications({});
                      setError(null);
                      setSuccess(false);
                    },
                  },
                  "Сменить объект"
                )
              )
            ),
            counters.length > 0
              ? React.createElement(
                  "form",
                  { onSubmit: handleSubmitReadings },
                  React.createElement(
                    "div",
                    null,
                    React.createElement(
                      "div",
                      { className: "field-label" },
                      "Дата показаний",
                      React.createElement("span", null, "*")
                    ),
                    React.createElement("input", {
                      className: "input",
                      type: "date",
                      required: true,
                      value: readingDate,
                      onChange: function (e) {
                        setReadingDate(e.target.value);
                      },
                      disabled: submitting,
                    })
                  ),
                  React.createElement("div", { className: "divider" }),
                  React.createElement(
                    "div",
                    { className: "field-label" },
                    "Показания счётчиков"
                  ),
                  React.createElement(
                    "div",
                    { style: { display: "flex", flexDirection: "column", gap: "12px" } },
                    counters.map(function (counter) {
                      return React.createElement(
                        "div",
                        { key: counter.id },
                        React.createElement(
                          "div",
                          { className: "field-label" },
                          counter.counter_type,
                          counter.counter_number
                            ? " • № " + counter.counter_number
                            : "",
                          counter.counter_comment
                            ? React.createElement(
                                "div",
                                { style: { fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" } },
                                counter.counter_comment
                              )
                            : null
                        ),
                        React.createElement("input", {
                          className: "input",
                          type: "number",
                          step: "0.01",
                          placeholder: "Введите показание",
                          value: indications[counter.id] || "",
                          onChange: function (e) {
                            handleIndicationChange(counter.id, e.target.value);
                          },
                          disabled: submitting,
                        })
                      );
                    })
                  ),
                  React.createElement(
                    "button",
                    {
                      className: "button",
                      type: "submit",
                      disabled: submitting,
                    },
                    submitting ? "Сохранение..." : "Сохранить показания"
                  )
                )
              : React.createElement(
                  "div",
                  { className: "alert alert-info" },
                  React.createElement("div", { className: "alert-icon" }, "i"),
                  React.createElement(
                    "div",
                    { className: "alert-body" },
                    React.createElement(
                      "div",
                      { className: "alert-title" },
                      "Нет активных счётчиков"
                    ),
                    React.createElement(
                      "div",
                      { className: "alert-text" },
                      "У этого объекта нет активных счётчиков. Добавьте счётчики через редактирование объекта."
                    )
                  )
                )
          ),
      error &&
        React.createElement(
          "div",
          { className: "alert alert-error" },
          React.createElement("div", { className: "alert-icon" }, "!"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement("div", { className: "alert-title" }, "Ошибка"),
            React.createElement("div", { className: "alert-text" }, error)
          )
        ),
      success &&
        React.createElement(
          "div",
          { className: "alert alert-success" },
          React.createElement("div", { className: "alert-icon" }, "✓"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement(
              "div",
              { className: "alert-title" },
              "Показания сохранены"
            ),
            React.createElement(
              "div",
              { className: "alert-text" },
              "Показания успешно внесены в систему."
            )
          )
        )
    );
  }

  function CreateObjectScreen(props) {
    var objectNameState = useState("");
    var objectName = objectNameState[0];
    var setObjectName = objectNameState[1];

    var objectAddressState = useState("");
    var objectAddress = objectAddressState[0];
    var setObjectAddress = objectAddressState[1];

    var areaState = useState("");
    var area = areaState[0];
    var setArea = areaState[1];

    var contactsState = useState("");
    var contacts = contactsState[0];
    var setContacts = contactsState[1];

    var commentsState = useState("");
    var comments = commentsState[0];
    var setComments = commentsState[1];

    var selectedCountersState = useState({});
    var selectedCounters = selectedCountersState[0];
    var setSelectedCounters = selectedCountersState[1];

    // Initialize selectedCounters when counterTypes loads
    useEffect(function () {
      if (props.counterTypes && props.counterTypes.length > 0) {
        var initialCounters = props.counterTypes.reduce(function (acc, type) {
          acc[type] = false;
          return acc;
        }, {});
        setSelectedCounters(initialCounters);
      }
    }, [props.counterTypes]);

    var counterNumbersState = useState({});
    var counterNumbers = counterNumbersState[0];
    var setCounterNumbers = counterNumbersState[1];
    var counterCommentsState = useState({});
    var counterComments = counterCommentsState[0];
    var setCounterComments = counterCommentsState[1];
    var counterOperatorsState = useState({});
    var counterOperators = counterOperatorsState[0];
    var setCounterOperators = counterOperatorsState[1];
    var counterVerificationDatesState = useState({});
    var counterVerificationDates = counterVerificationDatesState[0];
    var setCounterVerificationDates = counterVerificationDatesState[1];
    var counterValidUntilState = useState({});
    var counterValidUntil = counterValidUntilState[0];
    var setCounterValidUntil = counterValidUntilState[1];
    var counterLkUrlState = useState({});
    var counterLkUrl = counterLkUrlState[0];
    var setCounterLkUrl = counterLkUrlState[1];
    var counterLkLoginState = useState({});
    var counterLkLogin = counterLkLoginState[0];
    var setCounterLkLogin = counterLkLoginState[1];
    var counterLkPasswordState = useState({});
    var counterLkPassword = counterLkPasswordState[0];
    var setCounterLkPassword = counterLkPasswordState[1];
    var counterLkCommentState = useState({});
    var counterLkComment = counterLkCommentState[0];
    var setCounterLkComment = counterLkCommentState[1];

    var submittingState = useState(false);
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    var successState = useState(false);
    var success = successState[0];
    var setSuccess = successState[1];

    var assignedEmployeeIdState = useState("");
    var assignedEmployeeId = assignedEmployeeIdState[0];
    var setAssignedEmployeeId = assignedEmployeeIdState[1];

    var ownerIdState = useState("");
    var ownerId = ownerIdState[0];
    var setOwnerId = ownerIdState[1];

    var userListState = useState([]);
    var userList = userListState[0];
    var setUserList = userListState[1];

    useEffect(function () {
      supabase
        .from("employees")
        .select("id, first_name, last_name, email")
        .eq("role", "user")
        .eq("is_active", true)
        .order("first_name")
        .then(function (res) {
          if (!res.error && res.data) setUserList(res.data);
        });
    }, []);

    function handleCounterToggle(type) {
      var updated = {};
      for (var key in selectedCounters) {
        updated[key] = selectedCounters[key];
      }
      updated[type] = !selectedCounters[type];
      setSelectedCounters(updated);
    }

    function handleCounterNumberChange(type, value) {
      var updated = {};
      for (var key in counterNumbers) {
        updated[key] = counterNumbers[key];
      }
      updated[type] = value;
      setCounterNumbers(updated);
    }

    function handleCounterCommentChange(type, value) {
      var updated = {};
      for (var key in counterComments) {
        updated[key] = counterComments[key];
      }
      updated[type] = value;
      setCounterComments(updated);
    }

    function handleCounterOperatorChange(type, value) {
      var updated = {};
      for (var key in counterOperators) {
        updated[key] = counterOperators[key];
      }
      updated[type] = value;
      setCounterOperators(updated);
    }

    function handleCounterVerificationDateChange(type, value) {
      var updated = {};
      for (var key in counterVerificationDates) {
        updated[key] = counterVerificationDates[key];
      }
      updated[type] = value;
      setCounterVerificationDates(updated);
    }

    function handleCounterValidUntilChange(type, value) {
      var updated = {};
      for (var key in counterValidUntil) {
        updated[key] = counterValidUntil[key];
      }
      updated[type] = value;
      setCounterValidUntil(updated);
    }

    function handleCounterLkUrlChange(type, value) {
      var updated = {};
      for (var key in counterLkUrl) {
        updated[key] = counterLkUrl[key];
      }
      updated[type] = value;
      setCounterLkUrl(updated);
    }

    function handleCounterLkLoginChange(type, value) {
      var updated = {};
      for (var key in counterLkLogin) {
        updated[key] = counterLkLogin[key];
      }
      updated[type] = value;
      setCounterLkLogin(updated);
    }

    function handleCounterLkPasswordChange(type, value) {
      var updated = {};
      for (var key in counterLkPassword) {
        updated[key] = counterLkPassword[key];
      }
      updated[type] = value;
      setCounterLkPassword(updated);
    }

    function handleCounterLkCommentChange(type, value) {
      var updated = {};
      for (var key in counterLkComment) {
        updated[key] = counterLkComment[key];
      }
      updated[type] = value;
      setCounterLkComment(updated);
    }

    function handleSubmit(e) {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!objectName.trim() || !objectAddress.trim()) {
        setError("Название и адрес объекта обязательны.");
        return;
      }

      var hasCounters = false;
      for (var key in selectedCounters) {
        if (selectedCounters[key]) {
          hasCounters = true;
          break;
        }
      }

      if (!hasCounters) {
        setError("Выберите хотя бы один тип счётчика.");
        return;
      }

      setSubmitting(true);

      var objectData = {
        object_name: objectName.trim(),
        object_address: objectAddress.trim(),
        area: area.trim() ? parseFloat(area) : null,
        contacts: contacts.trim() || null,
        comments: comments.trim() || null,
        is_active: true,
        assigned_employee_id: assignedEmployeeId ? parseInt(assignedEmployeeId, 10) : null,
        owner_id: ownerId && ownerId.trim() ? ownerId.trim() : null,
      };

      supabase
        .from("objects")
        .insert([objectData])
        .select()
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось создать объект: " + result.error.message);
            setSubmitting(false);
            return;
          }

          var newObject = result.data[0];
          var countersToInsert = [];

          for (var type in selectedCounters) {
            if (selectedCounters[type]) {
              var counterNumber = counterNumbers[type];
              var counterComment = counterComments[type];
              var counterOperator = counterOperators[type];
              var verificationDate = counterVerificationDates[type];
              var validUntilDate = counterValidUntil[type];
              var lkUrl = counterLkUrl[type];
              var lkLogin = counterLkLogin[type];
              var lkPassword = counterLkPassword[type];
              var lkComment = counterLkComment[type];
              countersToInsert.push({
                object_id: newObject.id,
                counter_type: type,
                counter_number: counterNumber && counterNumber.trim() ? counterNumber.trim() : null,
                counter_comment: counterComment && counterComment.trim() ? counterComment.trim() : null,
                verification_date: verificationDate && verificationDate.trim() ? verificationDate.trim() : null,
                valid_until: validUntilDate && validUntilDate.trim() ? validUntilDate.trim() : null,
                operator_id: counterOperator && counterOperator.trim ? counterOperator.trim() : null,
                lk_url: lkUrl && lkUrl.trim ? lkUrl.trim() : null,
                lk_login: lkLogin && lkLogin.trim ? lkLogin.trim() : null,
                lk_password: lkPassword && lkPassword.trim ? lkPassword.trim() : null,
                lk_comment: lkComment && lkComment.trim ? lkComment.trim() : null,
                is_active: true,
              });
            }
          }

          return supabase
            .from("counters")
            .insert(countersToInsert)
            .then(function (counterResult) {
              if (counterResult.error) {
                console.error(counterResult.error);
                setError(
                  "Объект создан, но не удалось добавить счётчики: " +
                    counterResult.error.message
                );
                setSubmitting(false);
                return;
              }

              setSuccess(true);
              setSubmitting(false);

              setObjectName("");
              setObjectAddress("");
              setArea("");
              setContacts("");
              setComments("");
              setAssignedEmployeeId("");
              setOwnerId("");
              setSelectedCounters(
                (props.counterTypes || []).reduce(function (acc, type) {
                  acc[type] = false;
                  return acc;
                }, {})
              );
              setCounterNumbers({});
              setCounterComments({});
              setCounterOperators({});
              setCounterVerificationDates({});
              setCounterValidUntil({});
            });
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при создании объекта.");
          setSubmitting(false);
        });
    }

    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { className: "top-bar" },
        React.createElement(
          "button",
          {
            className: "back-button",
            onClick: function () {
              props.onNavigate("menu");
            },
          },
          "← Назад в меню"
        )
      ),
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "panel-title" },
            "Создать объект"
          ),
          React.createElement(
            "div",
            { className: "panel-subtitle" },
            "Добавление нового объекта учёта и его счётчиков"
          )
        ),
        React.createElement("span", { className: "badge" }, "Блок 04")
      ),
      React.createElement("div", { className: "divider" }),
      React.createElement(
        "form",
        { className: "form", onSubmit: handleSubmit },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Название объекта",
            React.createElement("span", null, "*")
          ),
          React.createElement("input", {
            className: "input",
            type: "text",
            required: true,
            placeholder: "Например: Офис на Ленина",
            value: objectName,
            onChange: function (e) {
              setObjectName(e.target.value);
            },
            disabled: submitting,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Адрес объекта",
            React.createElement("span", null, "*")
          ),
          React.createElement("input", {
            className: "input",
            type: "text",
            required: true,
            placeholder: "Полный адрес объекта",
            value: objectAddress,
            onChange: function (e) {
              setObjectAddress(e.target.value);
            },
            disabled: submitting,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Площадь (м²)"
          ),
          React.createElement("input", {
            className: "input",
            type: "number",
            step: "0.01",
            placeholder: "Площадь объекта",
            value: area,
            onChange: function (e) {
              setArea(e.target.value);
            },
            disabled: submitting,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Контакты"
          ),
          React.createElement("textarea", {
            className: "input",
            rows: 2,
            placeholder: "ФИО, телефон, email ответственного лица",
            value: contacts,
            onChange: function (e) {
              setContacts(e.target.value);
            },
            disabled: submitting,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Комментарии"
          ),
          React.createElement("textarea", {
            className: "input",
            rows: 2,
            placeholder: "Дополнительная информация",
            value: comments,
            onChange: function (e) {
              setComments(e.target.value);
            },
            disabled: submitting,
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Владелец (принадлежность объекта)"
          ),
          React.createElement(
            "select",
            {
              className: "input",
              value: ownerId,
              onChange: function (e) {
                setOwnerId(e.target.value);
              },
              disabled: submitting,
            },
            React.createElement("option", { value: "" }, "— Не выбрано —"),
            (props.owners || []).map(function (o) {
              return React.createElement(
                "option",
                { key: o.id, value: o.id },
                o.name
              );
            })
          ),
          ownerId &&
            React.createElement(
              "div",
              { className: "hint", style: { marginTop: "4px", fontSize: "11px" } },
              "Выбрано: ",
              ((props.owners || []).find(function (o) { return String(o.id) === String(ownerId); }) || {}).name || ""
            )
        ),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Закрепить за пользователем"
          ),
          React.createElement(
            "select",
            {
              className: "input",
              value: assignedEmployeeId,
              onChange: function (e) {
                setAssignedEmployeeId(e.target.value);
              },
              disabled: submitting,
            },
            React.createElement("option", { value: "" }, "— Не назначен —"),
            userList.map(function (emp) {
              return React.createElement(
                "option",
                { key: emp.id, value: String(emp.id) },
                (emp.first_name || "") + " " + (emp.last_name || "") + (emp.email ? " (" + emp.email + ")" : "")
              );
            })
          ),
          assignedEmployeeId &&
            React.createElement(
              "div",
              { className: "hint", style: { marginTop: "4px", fontSize: "11px" } },
              "Выбрано: ",
              (function () {
                var emp = userList.find(function (e) { return String(e.id) === String(assignedEmployeeId); });
                if (!emp) return "";
                var name = ((emp.first_name || "") + " " + (emp.last_name || "")).trim();
                var email = emp.email || "";
                return (name || email || "").trim();
              })()
            )
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          { className: "field-label" },
          "Типы счётчиков",
          React.createElement("span", null, "*")
        ),
        React.createElement(
          "div",
          { className: "hint", style: { marginBottom: "12px" } },
          "Список загружается из базы данных. Выберите нужные типы и укажите номера приборов (опционально)."
        ),
        !(props.counterTypes && props.counterTypes.length) ? React.createElement(
          "div",
          { className: "hint", style: { padding: "12px", color: "rgba(255,255,255,0.6)" } },
          "Типы счётчиков загружаются..."
        ) : React.createElement(
          "div",
          { 
            style: { 
              display: "grid", 
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "12px" 
            } 
          },
          props.counterTypes.map(function (counterType) {
            return (function (type) {
              return React.createElement(
                "div",
                { 
                  key: type,
                  style: { 
                    display: "flex", 
                    flexDirection: "column",
                    gap: "6px",
                    padding: "8px",
                    border: "1px solid rgba(148, 163, 184, 0.3)",
                    borderRadius: "8px",
                  } 
                },
                React.createElement(
                  "label",
                  { style: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" } },
                  React.createElement("input", {
                    type: "checkbox",
                    checked: selectedCounters[type] || false,
                    onChange: function () { handleCounterToggle(type); },
                    disabled: submitting,
                  }),
                  React.createElement("span", { style: { fontWeight: "500" } }, type)
                ),
                selectedCounters[type] && React.createElement(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: "4px" } },
                  React.createElement("input", {
                    className: "input",
                    type: "text",
                    placeholder: "Номер прибора (опц.)",
                    value: counterNumbers[type] || "",
                    onChange: function (e) { handleCounterNumberChange(type, e.target.value); },
                    disabled: submitting,
                    style: { marginTop: "0" },
                  }),
                  React.createElement("input", {
                    className: "input",
                    type: "text",
                    placeholder: "Комментарий (опц.)",
                    value: counterComments[type] || "",
                    onChange: function (e) { handleCounterCommentChange(type, e.target.value); },
                    disabled: submitting,
                    style: { marginTop: "0" },
                  }),
                  React.createElement(
                    "select",
                    {
                      className: "input",
                      value: counterOperators[type] || "",
                      onChange: function (e) { handleCounterOperatorChange(type, e.target.value); },
                      disabled: submitting,
                      style: { marginTop: "0" },
                    },
                    React.createElement("option", { value: "" }, "Оператор не выбран"),
                    (props.operators || []).map(function (op) {
                      return React.createElement(
                        "option",
                        { key: op.id, value: op.id },
                        op.name
                      );
                    })
                  ),
                  React.createElement(
                    "div",
                    { className: "hint", style: { marginBottom: "0", fontSize: "11px", marginTop: "4px" } },
                    "Вход в личный кабинет"
                  ),
                  React.createElement("input", {
                    className: "input",
                    type: "text",
                    placeholder: "Ссылка на ЛК (опц.)",
                    value: counterLkUrl[type] || "",
                    onChange: function (e) { handleCounterLkUrlChange(type, e.target.value); },
                    disabled: submitting,
                    style: { marginTop: "0" },
                  }),
                  React.createElement("input", {
                    className: "input",
                    type: "text",
                    placeholder: "Логин ЛК (опц.)",
                    value: counterLkLogin[type] || "",
                    onChange: function (e) { handleCounterLkLoginChange(type, e.target.value); },
                    disabled: submitting,
                    style: { marginTop: "0" },
                  }),
                  React.createElement("input", {
                    className: "input",
                    type: "text",
                    placeholder: "Пароль ЛК (опц.)",
                    value: counterLkPassword[type] || "",
                    onChange: function (e) { handleCounterLkPasswordChange(type, e.target.value); },
                    disabled: submitting,
                    style: { marginTop: "0" },
                  }),
                  React.createElement("input", {
                    className: "input",
                    type: "text",
                    placeholder: "Комментарий ЛК (опц.)",
                    value: counterLkComment[type] || "",
                    onChange: function (e) { handleCounterLkCommentChange(type, e.target.value); },
                    disabled: submitting,
                    style: { marginTop: "0" },
                  }),
                  React.createElement(
                    "div",
                    { className: "hint", style: { marginBottom: "0", fontSize: "11px" } },
                    "Дата поверки"
                  ),
                  React.createElement("input", {
                    className: "input",
                    type: "date",
                    value: counterVerificationDates[type] || "",
                    onChange: function (e) { handleCounterVerificationDateChange(type, e.target.value); },
                    disabled: submitting,
                    style: { marginTop: "0" },
                  }),
                  React.createElement(
                    "div",
                    { className: "hint", style: { marginBottom: "0", fontSize: "11px" } },
                    "Действует до"
                  ),
                  React.createElement("input", {
                    className: "input",
                    type: "date",
                    value: counterValidUntil[type] || "",
                    onChange: function (e) { handleCounterValidUntilChange(type, e.target.value); },
                    disabled: submitting,
                    style: { marginTop: "0" },
                  })
                )
              );
            })(counterType);
          })
        ),
        React.createElement(
          "button",
          {
            className: "button",
            type: "submit",
            disabled: submitting,
          },
          submitting ? "Создание..." : "Создать объект"
        )
      ),
      error &&
        React.createElement(
          "div",
          { className: "alert alert-error" },
          React.createElement("div", { className: "alert-icon" }, "!"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement(
              "div",
              { className: "alert-title" },
              "Ошибка"
            ),
            React.createElement("div", { className: "alert-text" }, error)
          )
        ),
      success &&
        React.createElement(
          "div",
          { className: "alert alert-success" },
          React.createElement("div", { className: "alert-icon" }, "✓"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement(
              "div",
              { className: "alert-title" },
              "Объект создан"
            ),
            React.createElement(
              "div",
              { className: "alert-text" },
              "Объект успешно добавлен в систему со счётчиками."
            )
          )
        )
    );
  }

  function StatsScreen(props) {
    var searchQueryState = useState("");
    var searchQuery = searchQueryState[0];
    var setSearchQuery = searchQueryState[1];

    var objectsState = useState([]);
    var objects = objectsState[0];
    var setObjects = objectsState[1];

    var selectedObjectState = useState(null);
    var selectedObject = selectedObjectState[0];
    var setSelectedObject = selectedObjectState[1];

    var searchingState = useState(false);
    var searching = searchingState[0];
    var setSearching = searchingState[1];

    var stepState = useState("select");
    var step = stepState[0];
    var setStep = stepState[1];

    var startMonthState = useState("");
    var startMonth = startMonthState[0];
    var setStartMonth = startMonthState[1];

    var endMonthState = useState("");
    var endMonth = endMonthState[0];
    var setEndMonth = endMonthState[1];

    var statisticsState = useState(null);
    var statistics = statisticsState[0];
    var setStatistics = statisticsState[1];

    var loadingState = useState(false);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    useEffect(function () {
      if (step === "select") {
        loadAllObjects();
      }
    }, [step]);

    function loadAllObjects() {
      setSearching(true);
      setError(null);

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка загрузки объектов");
            setSearching(false);
            return;
          }

          var sorted = result.data.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке объектов");
          setSearching(false);
        });
    }

    function handleSearch() {
      if (!searchQuery.trim()) {
        loadAllObjects();
        return;
      }

      setSearching(true);
      setError(null);

      var query = searchQuery.trim().toLowerCase();

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка поиска объектов");
            setSearching(false);
            return;
          }

          var filtered = result.data.filter(function (obj) {
            var name = (obj.object_name || "").toLowerCase();
            var address = (obj.object_address || "").toLowerCase();
            return name.indexOf(query) !== -1 || address.indexOf(query) !== -1;
          });

          var sorted = filtered.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);

          if (sorted.length === 0) {
            setError("Объекты не найдены. Попробуйте изменить запрос.");
          }
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при поиске объектов");
          setSearching(false);
        });
    }

    function handleSelectObject(obj) {
      setSelectedObject(obj);
      setStep("select-period");
      setError(null);
      
      var today = new Date();
      var currentYear = today.getFullYear();
      var currentMonth = String(today.getMonth() + 1).padStart(2, "0");
      var threeMonthsAgo = new Date(today);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      var startYear = threeMonthsAgo.getFullYear();
      var startMonthNum = String(threeMonthsAgo.getMonth() + 1).padStart(2, "0");
      
      setStartMonth(startYear + "-" + startMonthNum);
      setEndMonth(currentYear + "-" + currentMonth);
    }

    function handleLoadStatistics() {
      if (!startMonth || !endMonth) {
        setError("Выберите период");
        return;
      }

      if (startMonth > endMonth) {
        setError("Начальный месяц не может быть позже конечного");
        return;
      }

      setError(null);
      setLoading(true);

      supabase
        .from("counters")
        .select("id, counter_type, counter_number, counter_comment")
        .eq("object_id", selectedObject.id)
        .eq("is_active", true)
        .then(function (countersResult) {
          if (countersResult.error) {
            console.error(countersResult.error);
            setError("Ошибка загрузки счётчиков");
            setLoading(false);
            return;
          }

          if (countersResult.data.length === 0) {
            setError("У объекта нет активных счётчиков");
            setLoading(false);
            return;
          }

          // Сортируем счётчики по приоритету типов из таблицы counter_types
          var countersList = countersResult.data.slice();
          if (props.counterTypes && props.counterTypes.length) {
            var orderMap = {};
            for (var i = 0; i < props.counterTypes.length; i++) {
              orderMap[props.counterTypes[i]] = i;
            }
            countersList.sort(function (a, b) {
              var ia = Object.prototype.hasOwnProperty.call(orderMap, a.counter_type)
                ? orderMap[a.counter_type]
                : 9999;
              var ib = Object.prototype.hasOwnProperty.call(orderMap, b.counter_type)
                ? orderMap[b.counter_type]
                : 9999;
              if (ia !== ib) return ia - ib;
              var nameA = (a.counter_type || "").toLowerCase();
              var nameB = (b.counter_type || "").toLowerCase();
              if (nameA < nameB) return -1;
              if (nameA > nameB) return 1;
              return 0;
            });
          }

          var counterIds = countersList.map(function (c) {
            return c.id;
          });

          var startDate = startMonth + "-01";
          var endParts = endMonth.split("-");
          var endYear = parseInt(endParts[0]);
          var endMonthNum = parseInt(endParts[1]);
          var nextMonth = endMonthNum === 12 ? 1 : endMonthNum + 1;
          var nextYear = endMonthNum === 12 ? endYear + 1 : endYear;
          var endDate = nextYear + "-" + String(nextMonth).padStart(2, "0") + "-01";

          return supabase
            .from("meter_readings")
            .select("*")
            .in("counter_id", counterIds)
            .gte("reading_date", startDate)
            .lt("reading_date", endDate)
            .then(function (readingsResult) {
              if (readingsResult.error) {
                console.error(readingsResult.error);
                setError("Ошибка загрузки показаний");
                setLoading(false);
                return;
              }

              var months = [];
              var currentDate = new Date(startMonth + "-01");
              var endDateObj = new Date(endMonth + "-01");
              
              while (currentDate <= endDateObj) {
                var year = currentDate.getFullYear();
                var month = String(currentDate.getMonth() + 1).padStart(2, "0");
                months.push(year + "-" + month);
                currentDate.setMonth(currentDate.getMonth() + 1);
              }

              var monthNames = {
                "01": "Январь", "02": "Февраль", "03": "Март", "04": "Апрель",
                "05": "Май", "06": "Июнь", "07": "Июль", "08": "Август",
                "09": "Сентябрь", "10": "Октябрь", "11": "Ноябрь", "12": "Декабрь"
              };

              var statsData = {
                counters: countersList,
                months: months.map(function(m) {
                  var parts = m.split("-");
                  return {
                    key: m,
                    label: monthNames[parts[1]] + " " + parts[0]
                  };
                }),
                data: {},
                // consumption[counterId][monthKey] = разница между последним значением этого месяца и предыдущего
                consumption: {}
              };

              countersList.forEach(function(counter) {
                statsData.data[counter.id] = {};
                statsData.consumption[counter.id] = {};

                // Сохраняем показания по месяцам
                months.forEach(function(month) {
                  var readings = readingsResult.data.filter(function(r) {
                    return r.counter_id === counter.id && r.reading_date.startsWith(month);
                  });
                  if (readings.length > 0) {
                    var sorted = readings.slice().sort(function(a, b) {
                      return a.reading_date.localeCompare(b.reading_date);
                    });
                    statsData.data[counter.id][month] = sorted.map(function(r) {
                      return { date: r.reading_date, value: r.indication };
                    });
                  } else {
                    statsData.data[counter.id][month] = [];
                  }
                });

                // Считаем помесячное потребление (разница с предыдущим месяцем)
                for (var mi = 1; mi < months.length; mi++) {
                  var prevKey = months[mi - 1];
                  var currKey = months[mi];
                  var prevList = statsData.data[counter.id][prevKey] || [];
                  var currList = statsData.data[counter.id][currKey] || [];
                  if (prevList.length > 0 && currList.length > 0) {
                    var prevLast = prevList[prevList.length - 1].value;
                    var currLast = currList[currList.length - 1].value;
                    var diff = currLast - prevLast;
                    statsData.consumption[counter.id][currKey] = diff;
                  } else {
                    // Если нет предыдущего или текущего месяца — потребление не показываем
                    statsData.consumption[counter.id][currKey] = null;
                  }
                }
              });

              setStatistics(statsData);
              setStep("view");
              setLoading(false);
            });
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке данных");
          setLoading(false);
        });
    }

    function handleExportStatisticsToExcel() {
      if (!statistics || !statistics.counters || !statistics.months) return;

      // Используем точку с запятой как разделитель столбцов (подходит для русской локали Excel)
      var sep = ";";
      var rows = [];

      // Первая строка: название объекта
      rows.push([
        "Объект",
        selectedObject && selectedObject.object_name
          ? selectedObject.object_name
          : ""
      ]);

      // Вторая строка: пустая (для красоты)
      rows.push([]);

      // Третья строка: заголовки колонок
      // Для каждого месяца создаём 3 колонки: значение, дата, расход
      var header = ["Счётчик"];
      statistics.months.forEach(function (m) {
        header.push(m.label + " — значение");
        header.push(m.label + " — дата");
        header.push(m.label + " — расход");
      });
      rows.push(header);

      // Строки по счётчикам
      statistics.counters.forEach(function (counter) {
        var firstCol = counter.counter_type +
          (counter.counter_number ? " № " + counter.counter_number : "") +
          (counter.counter_comment ? " — " + counter.counter_comment : "");

        var row = [firstCol];

        statistics.months.forEach(function (month) {
          var readingsInMonth =
            (statistics.data &&
              statistics.data[counter.id] &&
              statistics.data[counter.id][month.key]) ||
            [];
          var consumptionValue =
            statistics.consumption &&
            statistics.consumption[counter.id] &&
            statistics.consumption[counter.id][month.key] != null
              ? Number(statistics.consumption[counter.id][month.key]).toFixed(3)
              : null;

          if (readingsInMonth.length === 0) {
            // Для месяца всегда добавляем 3 ячейки: значение, дата, расход
            row.push("—"); // значение
            row.push("—"); // дата
            row.push("");  // расход
          } else {
            // Берём последнее показание месяца (как в расчёте расхода)
            var last = readingsInMonth[readingsInMonth.length - 1];

            // Значение показаний
            row.push(last.value);

            // Дата в формате ДД.ММ.ГГГГ
            var dateStr = last.date;
            if (dateStr && dateStr.length >= 10) {
              var parts = dateStr.split("-");
              dateStr = parts[2] + "." + parts[1] + "." + parts[0];
            }
            row.push(dateStr);

            // Расход (если есть)
            row.push(consumptionValue != null ? consumptionValue : "");
          }
        });

        rows.push(row);
      });

      function esc(value) {
        if (value == null) return "";
        var s = String(value);
        if (s.indexOf('"') !== -1 || s.indexOf(sep) !== -1 || s.indexOf("\n") !== -1) {
          s = '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }

      var csv =
        "\uFEFF" +
        rows
          .map(function (row) {
            return row.map(esc).join(sep);
          })
          .join("\r\n");

      var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      var url = URL.createObjectURL(blob);

      var a = document.createElement("a");
      var periodLabel =
        (startMonth || "") + "_to_" + (endMonth || "");
      a.href = url;
      a.download =
        "statistics_" +
        (selectedObject && selectedObject.object_name
          ? selectedObject.object_name.replace(/[^a-zA-Z0-9_\\-]+/g, "_")
          : "object") +
        "_" +
        periodLabel +
        ".csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    if (step === "select") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
            onClick: function () {
              props.onNavigate("menu");
            },
          },
          "← Назад в меню"
        )
      ),
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "panel-title" },
            "Статистика"
          ),
          React.createElement(
            "div",
            { className: "panel-subtitle" },
            "Выберите объект для просмотра статистики"
          )
          ),
          React.createElement("span", { className: "badge" }, "Блок 06")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          null,
          searching && objects.length === 0 && !error &&
            React.createElement(
              "div",
              { className: "hint", style: { marginBottom: "12px" } },
              "⏳ Загрузка объектов..."
            ),
          React.createElement(
            "div",
            { className: "field-label" },
            "Поиск объекта"
          ),
          React.createElement(
            "div",
            { className: "hint", style: { marginBottom: "8px" } },
            "Введите название или адрес для поиска"
          ),
          React.createElement(
            "div",
            { style: { display: "flex", gap: "8px" } },
            React.createElement("input", {
              className: "input",
              type: "text",
              placeholder: "Поиск по названию или адресу",
              value: searchQuery,
              onChange: function (e) {
                setSearchQuery(e.target.value);
              },
              onKeyPress: function (e) {
                if (e.key === "Enter") {
                  handleSearch();
                }
              },
              disabled: searching,
            }),
            React.createElement(
              "button",
              {
                className: "button",
                type: "button",
                onClick: handleSearch,
                disabled: searching,
                style: { marginTop: 0 },
              },
              searching ? "Поиск..." : searchQuery.trim() ? "Найти" : "Обновить"
            ),
            searchQuery.trim() && React.createElement(
              "button",
              {
                className: "button-secondary button",
                type: "button",
                onClick: function () {
                  setSearchQuery("");
                  loadAllObjects();
                },
                disabled: searching,
                style: { marginTop: 0 },
              },
              "Очистить"
            )
          ),
          objects.length > 0 &&
            React.createElement(
              "div",
              { style: { marginTop: "16px" } },
              React.createElement(
                "div",
                { className: "field-label" },
                searchQuery.trim() 
                  ? "Найдено объектов: " + objects.length
                  : "Активных объектов: " + objects.length + " (отсортированы по алфавиту)"
              ),
              React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                objects.map(function (obj) {
                  return React.createElement(
                    "div",
                    {
                      key: obj.id,
                      className: "user-card",
                      onClick: function () {
                        handleSelectObject(obj);
                      },
                      style: { cursor: "pointer" },
                    },
                    React.createElement(
                      "div",
                      { className: "user-card-main" },
                      React.createElement(
                        "div",
                        { className: "user-meta" },
                        React.createElement(
                          "div",
                          { className: "user-name" },
                          obj.object_name
                        ),
                        React.createElement(
                          "div",
                          { className: "user-role" },
                          obj.object_address
                        )
                      )
                    ),
                    React.createElement(
                      "button",
                      {
                        className: "button-ghost",
                        type: "button",
                      },
                      "Выбрать →"
                    )
                  );
                })
              )
            )
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          )
      );
    }

    if (step === "select-period") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setStep("select");
                setSelectedObject(null);
                setError(null);
              },
            },
            "← К выбору объекта"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Выбор периода"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name
            )
          ),
          React.createElement("span", { className: "badge" }, "Статистика")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          { className: "form" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Начало периода",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "month",
              required: true,
              value: startMonth,
              onChange: function (e) {
                setStartMonth(e.target.value);
              },
              disabled: loading,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Конец периода",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "month",
              required: true,
              value: endMonth,
              onChange: function (e) {
                setEndMonth(e.target.value);
              },
              disabled: loading,
            })
          ),
          React.createElement(
            "button",
            {
              className: "button",
              type: "button",
              onClick: handleLoadStatistics,
              disabled: loading || !startMonth || !endMonth,
            },
            loading ? "Загрузка..." : "Показать статистику"
          )
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          )
      );
    }

    if (step === "view" && statistics) {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setStep("select-period");
                setStatistics(null);
                setError(null);
              },
            },
            "← Изменить период"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Статистика показаний"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name
            )
          ),
          React.createElement(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px" } },
            React.createElement("span", { className: "badge" }, "Счётчиков: " + statistics.counters.length),
            React.createElement(
              "button",
              {
                type: "button",
                className: "button-ghost",
                onClick: handleExportStatisticsToExcel,
              },
              "Экспорт в Excel"
            )
          )
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          { style: { overflowX: "auto", marginTop: "12px" } },
          React.createElement(
            "table",
            { 
              style: { 
                width: "100%", 
                borderCollapse: "collapse",
                fontSize: "12px"
              } 
            },
            React.createElement(
              "thead",
              null,
              React.createElement(
                "tr",
                null,
                React.createElement(
                  "th",
                  { 
                    style: { 
                      padding: "10px", 
                      textAlign: "left",
                      borderBottom: "2px solid rgba(148, 163, 184, 0.3)",
                      background: "rgba(56, 189, 248, 0.1)",
                      fontWeight: "600",
                      position: "sticky",
                      left: 0,
                      background: "rgba(15, 23, 42, 0.95)",
                      zIndex: 1
                    } 
                  },
                  "Счётчик"
                ),
                statistics.months.map(function(month) {
                  return React.createElement(
                    "th",
                    {
                      key: month.key,
                      style: {
                        padding: "10px",
                        textAlign: "center",
                        borderBottom: "2px solid rgba(148, 163, 184, 0.3)",
                        background: "rgba(56, 189, 248, 0.1)",
                        fontWeight: "600",
                        minWidth: "100px"
                      }
                    },
                    month.label
                  );
                })
              )
            ),
            React.createElement(
              "tbody",
              null,
              statistics.counters.map(function(counter) {
                return React.createElement(
                  "tr",
                  { key: counter.id },
                  React.createElement(
                    "td",
                    {
                      style: {
                        padding: "10px",
                        borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
                        fontWeight: "500",
                        position: "sticky",
                        left: 0,
                        background: "rgba(15, 23, 42, 0.95)",
                        zIndex: 1
                      }
                    },
                    React.createElement(
                      "div",
                      { style: { display: "flex", flexDirection: "column", gap: "2px" } },
                      React.createElement(
                        "div",
                        null,
                        counter.counter_type,
                        counter.counter_number ? React.createElement("span", { style: { color: "var(--text-muted)", fontSize: "11px" } }, " • № " + counter.counter_number) : null
                      ),
                      counter.counter_comment
                        ? React.createElement(
                            "div",
                            { style: { color: "var(--text-muted)", fontSize: "11px" } },
                            counter.counter_comment
                          )
                        : null
                    )
                  ),
                  statistics.months.map(function(month) {
                    var readingsInMonth = statistics.data[counter.id][month.key] || [];
                    var consumptionValue = statistics.consumption &&
                      statistics.consumption[counter.id] &&
                      statistics.consumption[counter.id][month.key] != null
                      ? statistics.consumption[counter.id][month.key]
                      : null;
                    var formattedConsumption = consumptionValue != null
                      ? Number(consumptionValue).toFixed(3)
                      : null;
                    var formatDate = function(ymd) {
                      if (!ymd || ymd.length < 10) return ymd;
                      var parts = ymd.split("-");
                      return parts[2] + "." + parts[1] + "." + parts[0];
                    };
                    return React.createElement(
                      "td",
                      {
                        key: month.key,
                        style: {
                          padding: "10px",
                          textAlign: "left",
                          borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
                          color: readingsInMonth.length > 0 ? "var(--text-main)" : "var(--text-muted)",
                          verticalAlign: "top"
                        }
                      },
                      readingsInMonth.length > 0
                        ? React.createElement(
                            "div",
                            { style: { display: "flex", flexDirection: "column", gap: "2px" } },
                            React.createElement(
                              "div",
                              { style: { whiteSpace: "nowrap" } },
                              readingsInMonth.map(function(r) { return r.value; }).join(", ")
                            ),
                            React.createElement(
                              "div",
                              { style: { whiteSpace: "nowrap", fontSize: "11px", color: "var(--text-muted)" } },
                              readingsInMonth.map(function(r) { return formatDate(r.date); }).join(", ")
                            ),
                formattedConsumption != null
                              ? React.createElement(
                                  "div",
                                  { style: { whiteSpace: "nowrap", fontSize: "11px", color: "rgba(74, 222, 128, 0.9)" } },
                                  formattedConsumption
                                )
                              : null
                          )
                        : "—"
                    );
                  })
                );
              })
            )
          )
        )
      );
    }

    return null;
  }

  function EditObjectScreen(props) {
    var searchQueryState = useState("");
    var searchQuery = searchQueryState[0];
    var setSearchQuery = searchQueryState[1];

    var objectsState = useState([]);
    var objects = objectsState[0];
    var setObjects = objectsState[1];

    var selectedObjectState = useState(null);
    var selectedObject = selectedObjectState[0];
    var setSelectedObject = selectedObjectState[1];

    var searchingState = useState(false);
    var searching = searchingState[0];
    var setSearching = searchingState[1];

    var stepState = useState("select");
    var step = stepState[0];
    var setStep = stepState[1];

    var objectNameState = useState("");
    var objectName = objectNameState[0];
    var setObjectName = objectNameState[1];

    var objectAddressState = useState("");
    var objectAddress = objectAddressState[0];
    var setObjectAddress = objectAddressState[1];

    var areaState = useState("");
    var area = areaState[0];
    var setArea = areaState[1];

    var contactsState = useState("");
    var contacts = contactsState[0];
    var setContacts = contactsState[1];

    var commentsState = useState("");
    var comments = commentsState[0];
    var setComments = commentsState[1];

    var submittingState = useState(false);
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    var successState = useState(false);
    var success = successState[0];
    var setSuccess = successState[1];

    var successMessageState = useState("");
    var successMessage = successMessageState[0];
    var setSuccessMessage = successMessageState[1];

    var selectedMonthState = useState("");
    var selectedMonth = selectedMonthState[0];
    var setSelectedMonth = selectedMonthState[1];

    var readingsState = useState([]);
    var readings = readingsState[0];
    var setReadings = readingsState[1];

    var editedReadingsState = useState({});
    var editedReadings = editedReadingsState[0];
    var setEditedReadings = editedReadingsState[1];

    var editedDatesState = useState({});
    var editedDates = editedDatesState[0];
    var setEditedDates = editedDatesState[1];

    var existingCountersState = useState([]);
    var existingCounters = existingCountersState[0];
    var setExistingCounters = existingCountersState[1];

    var selectedCountersState = useState({});
    var selectedCounters = selectedCountersState[0];
    var setSelectedCounters = selectedCountersState[1];

    var counterNumbersState = useState({});
    var counterNumbers = counterNumbersState[0];
    var setCounterNumbers = counterNumbersState[1];
    var counterCommentsState = useState({});
    var counterComments = counterCommentsState[0];
    var setCounterComments = counterCommentsState[1];
    var counterOperatorsState = useState({});
    var counterOperators = counterOperatorsState[0];
    var setCounterOperators = counterOperatorsState[1];
    var counterVerificationDatesState = useState({});
    var counterVerificationDates = counterVerificationDatesState[0];
    var setCounterVerificationDates = counterVerificationDatesState[1];
    var counterValidUntilState = useState({});
    var counterValidUntil = counterValidUntilState[0];
    var setCounterValidUntil = counterValidUntilState[1];
    var counterLkUrlState = useState({});
    var counterLkUrl = counterLkUrlState[0];
    var setCounterLkUrl = counterLkUrlState[1];
    var counterLkLoginState = useState({});
    var counterLkLogin = counterLkLoginState[0];
    var setCounterLkLogin = counterLkLoginState[1];
    var counterLkPasswordState = useState({});
    var counterLkPassword = counterLkPasswordState[0];
    var setCounterLkPassword = counterLkPasswordState[1];
    var counterLkCommentState = useState({});
    var counterLkComment = counterLkCommentState[0];
    var setCounterLkComment = counterLkCommentState[1];

    var assignedEmployeeIdState = useState("");
    var assignedEmployeeId = assignedEmployeeIdState[0];
    var setAssignedEmployeeId = assignedEmployeeIdState[1];

    var ownerIdState = useState("");
    var ownerId = ownerIdState[0];
    var setOwnerId = ownerIdState[1];

    var userListState = useState([]);
    var userList = userListState[0];
    var setUserList = userListState[1];

    useEffect(function () {
      supabase
        .from("employees")
        .select("id, first_name, last_name, email")
        .eq("role", "user")
        .eq("is_active", true)
        .order("first_name")
        .then(function (res) {
          if (!res.error && res.data) setUserList(res.data);
        });
    }, []);

    useEffect(function () {
      if (step === "select") {
        loadAllObjects();
      }
    }, [step]);

    function loadAllObjects() {
      setSearching(true);
      setError(null);

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка загрузки объектов");
            setSearching(false);
            return;
          }

          var sorted = result.data.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке объектов");
          setSearching(false);
        });
    }

    function handleSearch() {
      if (!searchQuery.trim()) {
        loadAllObjects();
        return;
      }

      setSearching(true);
      setError(null);

      var query = searchQuery.trim().toLowerCase();

      var q = supabase.from("objects").select("*").eq("is_active", true);
      if (props.employee && props.employee.role === "user") {
        q = q.eq("assigned_employee_id", props.employee.id);
      }
      q.then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка поиска объектов");
            setSearching(false);
            return;
          }

          var filtered = result.data.filter(function (obj) {
            var name = (obj.object_name || "").toLowerCase();
            var address = (obj.object_address || "").toLowerCase();
            return name.indexOf(query) !== -1 || address.indexOf(query) !== -1;
          });

          var sorted = filtered.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setSearching(false);

          if (sorted.length === 0) {
            setError("Объекты не найдены. Попробуйте изменить запрос.");
          }
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при поиске объектов");
          setSearching(false);
        });
    }

    function handleSelectObject(obj) {
      setSelectedObject(obj);
      setObjectName(obj.object_name || "");
      setObjectAddress(obj.object_address || "");
      setArea(obj.area ? String(obj.area) : "");
      setContacts(obj.contacts || "");
      setComments(obj.comments || "");
      setAssignedEmployeeId(obj.assigned_employee_id ? String(obj.assigned_employee_id) : "");
      setOwnerId(obj.owner_id ? String(obj.owner_id) : "");
      setEditedReadings({});
      setEditedDates({});
      setSelectedMonth("");
      setReadings([]);
      setError(null);
      setSuccess(false);
      setSuccessMessage("");

      supabase
        .from("counters")
        .select("*")
        .eq("object_id", obj.id)
        .eq("is_active", true)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось загрузить счётчики объекта");
            setStep("select");
            return;
          }

          setExistingCounters(result.data || []);
          
          var selected = {};
          var numbers = {};
          var commentsMap = {};
          var operatorsMap = {};
          var verificationMap = {};
          var validUntilMap = {};
          var lkUrlMap = {};
          var lkLoginMap = {};
          var lkPasswordMap = {};
          var lkCommentMap = {};
          
          for (var i = 0; i < result.data.length; i++) {
            var counter = result.data[i];
            selected[counter.counter_type] = true;
            if (counter.counter_number) {
              numbers[counter.counter_type] = counter.counter_number;
            }
            if (counter.counter_comment) {
              commentsMap[counter.counter_type] = counter.counter_comment;
            }
            if (counter.operator_id) {
              operatorsMap[counter.counter_type] = counter.operator_id;
            }
            if (counter.verification_date) {
              verificationMap[counter.counter_type] = counter.verification_date;
            }
            if (counter.valid_until) {
              validUntilMap[counter.counter_type] = counter.valid_until;
            }
            if (counter.lk_url) {
              lkUrlMap[counter.counter_type] = counter.lk_url;
            }
            if (counter.lk_login) {
              lkLoginMap[counter.counter_type] = counter.lk_login;
            }
            if (counter.lk_password) {
              lkPasswordMap[counter.counter_type] = counter.lk_password;
            }
            if (counter.lk_comment) {
              lkCommentMap[counter.counter_type] = counter.lk_comment;
            }
          }
          
          setSelectedCounters(selected);
          setCounterNumbers(numbers);
          setCounterComments(commentsMap);
          setCounterOperators(operatorsMap);
          setCounterVerificationDates(verificationMap);
          setCounterValidUntil(validUntilMap);
          setCounterLkUrl(lkUrlMap);
          setCounterLkLogin(lkLoginMap);
          setCounterLkPassword(lkPasswordMap);
          setCounterLkComment(lkCommentMap || {});
          setStep("edit");
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке счётчиков");
          setStep("select");
        });
    }

    function handleUpdateObject(e) {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!objectName.trim() || !objectAddress.trim()) {
        setError("Название и адрес объекта обязательны.");
        return;
      }

      setSubmitting(true);

      var updateData = {
        object_name: objectName.trim(),
        object_address: objectAddress.trim(),
        area: area.trim() ? parseFloat(area) : null,
        contacts: contacts.trim() || null,
        comments: comments.trim() || null,
        assigned_employee_id: assignedEmployeeId ? parseInt(assignedEmployeeId, 10) : null,
        owner_id: ownerId && ownerId.trim() ? ownerId.trim() : null,
      };

      supabase
        .from("objects")
        .update(updateData)
        .eq("id", selectedObject.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось обновить объект: " + result.error.message);
            setSubmitting(false);
            return;
          }

          var counterPromises = [];
          
          // Handle selected (checked) counter types — create new or update existing
          for (var counterType in selectedCounters) {
            if (selectedCounters[counterType]) {
              var existingCounter = null;
              for (var i = 0; i < existingCounters.length; i++) {
                if (existingCounters[i].counter_type === counterType) {
                  existingCounter = existingCounters[i];
                  break;
                }
              }
              
              if (!existingCounter) {
                // New counter — insert
                var newCounter = {
                  object_id: selectedObject.id,
                  counter_type: counterType,
                  counter_number: counterNumbers[counterType] ? counterNumbers[counterType].trim() : null,
                  counter_comment: counterComments[counterType] ? counterComments[counterType].trim() : null,
                  operator_id: counterOperators[counterType] ? counterOperators[counterType].trim() : null,
                  verification_date: counterVerificationDates[counterType] || null,
                  valid_until: counterValidUntil[counterType] || null,
                  lk_url: counterLkUrl[counterType] ? counterLkUrl[counterType].trim() : null,
                  lk_login: counterLkLogin[counterType] ? counterLkLogin[counterType].trim() : null,
                  lk_password: counterLkPassword[counterType] ? counterLkPassword[counterType].trim() : null,
                  lk_comment: counterLkComment[counterType] ? counterLkComment[counterType].trim() : null,
                  is_active: true
                };
                counterPromises.push(
                  supabase.from("counters").insert([newCounter])
                );
              } else {
                // Existing counter — update if changed
                var newNumber = counterNumbers[counterType] ? counterNumbers[counterType].trim() : null;
                var oldNumber = existingCounter.counter_number || null;
                var newComment = counterComments[counterType] ? counterComments[counterType].trim() : null;
                var oldComment = existingCounter.counter_comment || null;
                var newOp = counterOperators[counterType] ? counterOperators[counterType].trim() : null;
                var oldOp = existingCounter.operator_id || null;
                var newVerif = counterVerificationDates[counterType] || null;
                var oldVerif = existingCounter.verification_date || null;
                var newValid = counterValidUntil[counterType] || null;
                var oldValid = existingCounter.valid_until || null;
                var newLkUrl = counterLkUrl[counterType] ? counterLkUrl[counterType].trim() : null;
                var oldLkUrl = existingCounter.lk_url || null;
                var newLkLogin = counterLkLogin[counterType] ? counterLkLogin[counterType].trim() : null;
                var oldLkLogin = existingCounter.lk_login || null;
                var newLkPassword = counterLkPassword[counterType] ? counterLkPassword[counterType].trim() : null;
                var oldLkPassword = existingCounter.lk_password || null;
                var newLkComment = counterLkComment[counterType] ? counterLkComment[counterType].trim() : null;
                var oldLkComment = existingCounter.lk_comment || null;
                var wasActive = existingCounter.is_active !== false;
                
                if (!wasActive || newNumber !== oldNumber || newComment !== oldComment || newOp !== oldOp || newVerif !== oldVerif || newValid !== oldValid || newLkUrl !== oldLkUrl || newLkLogin !== oldLkLogin || newLkPassword !== oldLkPassword || newLkComment !== oldLkComment) {
                  counterPromises.push(
                    supabase
                      .from("counters")
                      .update({
                        counter_number: newNumber,
                        counter_comment: newComment,
                        operator_id: newOp,
                        verification_date: newVerif,
                        valid_until: newValid,
                        lk_url: newLkUrl,
                        lk_login: newLkLogin,
                        lk_password: newLkPassword,
                        lk_comment: newLkComment,
                        is_active: true
                      })
                      .eq("id", existingCounter.id)
                  );
                }
              }
            }
          }

          // Deactivate counters that were unchecked
          for (var j = 0; j < existingCounters.length; j++) {
            var ec = existingCounters[j];
            if (!selectedCounters[ec.counter_type] && ec.is_active !== false) {
              counterPromises.push(
                supabase
                  .from("counters")
                  .update({ is_active: false })
                  .eq("id", ec.id)
              );
            }
          }
          
          if (counterPromises.length === 0) {
            setSuccess(true);
            setSuccessMessage("Данные объекта успешно обновлены.");
            setSubmitting(false);
            setSelectedObject(Object.assign({}, selectedObject, updateData));
            return;
          }
          
          Promise.all(counterPromises)
            .then(function (counterResults) {
              var hasError = false;
              for (var i = 0; i < counterResults.length; i++) {
                if (counterResults[i].error) {
                  console.error("Counter update error:", counterResults[i].error);
                  hasError = true;
                }
              }
              
              if (hasError) {
                setError("Объект обновлён, но возникла ошибка при обновлении счётчиков");
                setSubmitting(false);
                return;
              }
              
              setSuccess(true);
              setSuccessMessage("Данные объекта и счётчиков успешно обновлены.");
              setSubmitting(false);
              setSelectedObject(Object.assign({}, selectedObject, updateData));
              
              supabase
                .from("counters")
                .select("*")
                .eq("object_id", selectedObject.id)
                .then(function (refreshResult) {
                  if (!refreshResult.error) {
                    setExistingCounters(refreshResult.data || []);
                  }
                });
            })
            .catch(function (err) {
              console.error("Counter save error:", err);
              setError("Объект обновлён, но ошибка при сохранении счётчиков");
              setSubmitting(false);
            });
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при обновлении объекта");
          setSubmitting(false);
        });
    }

    function handleArchiveObject() {
      if (!confirm("Перенести объект \"" + selectedObject.object_name + "\" в архив?")) {
        return;
      }

      setError(null);
      setSuccess(false);
      setSubmitting(true);

      supabase
        .from("objects")
        .update({ is_active: false })
        .eq("id", selectedObject.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось архивировать объект: " + result.error.message);
            setSubmitting(false);
            return;
          }

          setSuccess(true);
          setSuccessMessage("Объект перенесён в архив. Возврат в меню...");
          setSubmitting(false);
          
          setTimeout(function() {
            props.onNavigate("menu");
          }, 1500);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при архивировании объекта");
          setSubmitting(false);
        });
    }

    function handleGoToReadings() {
      setSelectedMonth("");
      setReadings([]);
      setEditedReadings({});
      setEditedDates({});
      setStep("select-month");
      setError(null);
      setSuccess(false);
      setSuccessMessage("");
    }

    function handleMonthSelect() {
      if (!selectedMonth) {
        setError("Выберите месяц");
        return;
      }

      setError(null);
      setSubmitting(true);

      var yearMonth = selectedMonth.split("-");
      var year = yearMonth[0];
      var month = yearMonth[1];
      var startDate = year + "-" + month + "-01";
      var nextMonth = parseInt(month) === 12 ? "01" : String(parseInt(month) + 1).padStart(2, "0");
      var nextYear = parseInt(month) === 12 ? String(parseInt(year) + 1) : year;
      var endDate = nextYear + "-" + nextMonth + "-01";

      supabase
        .from("counters")
        .select("id, counter_type, counter_number")
        .eq("object_id", selectedObject.id)
        .eq("is_active", true)
        .then(function (countersResult) {
          if (countersResult.error) {
            console.error(countersResult.error);
            setError("Ошибка загрузки счётчиков");
            setSubmitting(false);
            return;
          }

          var counterIds = countersResult.data.map(function (c) {
            return c.id;
          });

          return supabase
            .from("meter_readings")
            .select("*")
            .in("counter_id", counterIds)
            .gte("reading_date", startDate)
            .lt("reading_date", endDate)
            .then(function (readingsResult) {
              if (readingsResult.error) {
                console.error(readingsResult.error);
                setError("Ошибка загрузки показаний");
                setSubmitting(false);
                return;
              }

              var enrichedReadings = readingsResult.data.map(function (reading) {
                var counter = countersResult.data.find(function (c) {
                  return c.id === reading.counter_id;
                });
                return Object.assign({}, reading, {
                  counter_type: counter ? counter.counter_type : "",
                  counter_number: counter ? counter.counter_number : null,
                });
              });

              enrichedReadings.sort(function (a, b) {
                if (a.reading_date < b.reading_date) return -1;
                if (a.reading_date > b.reading_date) return 1;
                return 0;
              });

              setReadings(enrichedReadings);
              setEditedReadings({});
              setEditedDates({});
              setStep("edit-readings");
              setSubmitting(false);
            });
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке данных");
          setSubmitting(false);
        });
    }

    function handleReadingChange(readingId, newValue) {
      var updated = {};
      for (var key in editedReadings) {
        updated[key] = editedReadings[key];
      }
      updated[readingId] = newValue;
      setEditedReadings(updated);
    }

    function handleDateChange(readingId, newDate) {
      var updated = {};
      for (var key in editedDates) {
        updated[key] = editedDates[key];
      }
      updated[readingId] = newDate;
      setEditedDates(updated);
    }

    function handleSaveReadings() {
      setError(null);
      setSuccess(false);
      setSubmitting(true);

      var updatePromises = [];
      
      for (var i = 0; i < readings.length; i++) {
        var reading = readings[i];
        var updateData = {};
        var hasChanges = false;
        
        var currentValue = editedReadings[reading.id] !== undefined 
          ? editedReadings[reading.id] 
          : reading.indication;
        
        var currentDate = editedDates[reading.id] !== undefined 
          ? editedDates[reading.id] 
          : reading.reading_date;
        
        if (String(currentValue) !== String(reading.indication)) {
          updateData.indication = parseFloat(currentValue);
          hasChanges = true;
        }
        
        if (currentDate !== reading.reading_date) {
          updateData.reading_date = currentDate;
          hasChanges = true;
        }
        
        if (hasChanges) {
          console.log("Updating reading", reading.id, updateData);
          updatePromises.push(
            supabase
              .from("meter_readings")
              .update(updateData)
              .eq("id", reading.id)
          );
        }
      }

      if (updatePromises.length === 0) {
        setError("Нет изменений для сохранения");
        setSubmitting(false);
        return;
      }

      console.log("Sending", updatePromises.length, "updates");

      Promise.all(updatePromises)
        .then(function (results) {
          console.log("Update results:", results);
          var hasError = false;
          for (var i = 0; i < results.length; i++) {
            if (results[i].error) {
              hasError = true;
              console.error("Update error:", results[i].error);
            }
          }

          if (hasError) {
            setError("Не удалось обновить некоторые показания");
            setSubmitting(false);
            return;
          }

          setSuccess(true);
          setSubmitting(false);
          setEditedReadings({});
          setEditedDates({});
          
          setTimeout(function() {
            handleMonthSelect();
          }, 500);
        })
        .catch(function (err) {
          console.error("Save error:", err);
          setError("Ошибка при сохранении показаний: " + err.message);
          setSubmitting(false);
        });
    }

    if (step === "select") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                props.onNavigate("menu");
              },
            },
            "← Назад в меню"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Редактировать объект"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              "Выберите объект для редактирования"
            )
          ),
          React.createElement("span", { className: "badge" }, "Редактирование")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          null,
          searching && objects.length === 0 && !error &&
            React.createElement(
              "div",
              { className: "hint", style: { marginBottom: "12px" } },
              "⏳ Загрузка объектов..."
            ),
          React.createElement(
            "div",
            { className: "field-label" },
            "Поиск объекта"
          ),
          React.createElement(
            "div",
            { className: "hint", style: { marginBottom: "8px" } },
            "Введите название или адрес для поиска"
          ),
          React.createElement(
            "div",
            { style: { display: "flex", gap: "8px" } },
            React.createElement("input", {
              className: "input",
              type: "text",
              placeholder: "Поиск по названию или адресу",
              value: searchQuery,
              onChange: function (e) {
                setSearchQuery(e.target.value);
              },
              onKeyPress: function (e) {
                if (e.key === "Enter") {
                  handleSearch();
                }
              },
              disabled: searching,
            }),
            React.createElement(
              "button",
              {
                className: "button",
                type: "button",
                onClick: handleSearch,
                disabled: searching,
                style: { marginTop: 0 },
              },
              searching ? "Поиск..." : searchQuery.trim() ? "Найти" : "Обновить"
            ),
            searchQuery.trim() && React.createElement(
              "button",
              {
                className: "button-secondary button",
                type: "button",
                onClick: function () {
                  setSearchQuery("");
                  loadAllObjects();
                },
                disabled: searching,
                style: { marginTop: 0 },
              },
              "Очистить"
            )
          ),
          objects.length > 0 &&
            React.createElement(
              "div",
              { style: { marginTop: "16px" } },
              React.createElement(
                "div",
                { className: "field-label" },
                searchQuery.trim() 
                  ? "Найдено объектов: " + objects.length
                  : "Активных объектов: " + objects.length + " (отсортированы по алфавиту)"
              ),
              React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                objects.map(function (obj) {
                  return React.createElement(
                    "div",
                    {
                      key: obj.id,
                      className: "user-card",
                      onClick: function () {
                        handleSelectObject(obj);
                      },
                      style: { cursor: "pointer" },
                    },
                    React.createElement(
                      "div",
                      { className: "user-card-main" },
                      React.createElement(
                        "div",
                        { className: "user-meta" },
                        React.createElement(
                          "div",
                          { className: "user-name" },
                          obj.object_name
                        ),
                        React.createElement(
                          "div",
                          { className: "user-role" },
                          obj.object_address
                        )
                      )
                    ),
                    React.createElement(
                      "button",
                      {
                        className: "button-ghost",
                        type: "button",
                      },
                      "Редактировать →"
                    )
                  );
                })
              )
            )
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          )
      );
    }

    if (step === "edit") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setStep("select");
                setSelectedObject(null);
                setError(null);
                setSuccess(false);
              },
            },
            "← К списку объектов"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Редактирование объекта"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name
            )
          ),
          React.createElement("span", { className: "badge" }, "Данные объекта")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "form",
          { className: "form", onSubmit: handleUpdateObject },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Название объекта",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "text",
              required: true,
              placeholder: "Название объекта",
              value: objectName,
              onChange: function (e) {
                setObjectName(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Адрес объекта",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "text",
              required: true,
              placeholder: "Адрес объекта",
              value: objectAddress,
              onChange: function (e) {
                setObjectAddress(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Площадь (м²)"
            ),
            React.createElement("input", {
              className: "input",
              type: "number",
              step: "0.01",
              placeholder: "Площадь объекта",
              value: area,
              onChange: function (e) {
                setArea(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Контакты"
            ),
            React.createElement("textarea", {
              className: "input",
              rows: 2,
              placeholder: "ФИО, телефон, email ответственного лица",
              value: contacts,
              onChange: function (e) {
                setContacts(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Комментарии"
            ),
            React.createElement("textarea", {
              className: "input",
              rows: 2,
              placeholder: "Дополнительная информация",
              value: comments,
              onChange: function (e) {
                setComments(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Владелец (принадлежность объекта)"
            ),
            React.createElement(
              "select",
              {
                className: "input",
                value: ownerId,
                onChange: function (e) {
                  setOwnerId(e.target.value);
                },
                disabled: submitting,
              },
              React.createElement("option", { value: "" }, "— Не выбрано —"),
              (props.owners || []).map(function (o) {
                return React.createElement(
                  "option",
                  { key: o.id, value: o.id },
                  o.name
                );
              })
            )
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Закрепить за пользователем"
            ),
            React.createElement(
              "select",
              {
                className: "input",
                value: assignedEmployeeId,
                onChange: function (e) {
                  setAssignedEmployeeId(e.target.value);
                },
                disabled: submitting,
              },
              React.createElement("option", { value: "" }, "— Не назначен —"),
              userList.map(function (emp) {
                return React.createElement(
                  "option",
                  { key: emp.id, value: String(emp.id) },
                  (emp.first_name || "") + " " + (emp.last_name || "") + (emp.email ? " (" + emp.email + ")" : "")
                );
              })
            )
          ),
          React.createElement("div", { className: "divider" }),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Счётчики объекта"
            ),
            React.createElement(
              "div",
              { className: "hint", style: { marginBottom: "12px" } },
              "Отметьте типы счётчиков, установленных на объекте. Список типов загружается из базы данных. Для каждого типа можно указать номер прибора учёта."
            ),
            !(props.counterTypes && props.counterTypes.length) ? React.createElement(
              "div",
              { className: "hint", style: { padding: "12px", color: "rgba(255,255,255,0.6)" } },
              "Типы счётчиков загружаются..."
            ) : React.createElement(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "12px" } },
              props.counterTypes.map(function (counterType) {
                return (function (type) {
                  return React.createElement(
                    "div",
                    { 
                      key: type,
                      style: { 
                        display: "flex", 
                        flexDirection: "column",
                        gap: "6px",
                        padding: "10px",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "6px",
                        background: selectedCounters[type] ? "rgba(59, 130, 246, 0.1)" : "transparent"
                      } 
                    },
                    React.createElement(
                      "label",
                      { 
                        style: { 
                          display: "flex", 
                          alignItems: "center", 
                          gap: "8px", 
                          cursor: "pointer",
                          userSelect: "none"
                        } 
                      },
                      React.createElement("input", {
                        type: "checkbox",
                        checked: selectedCounters[type] || false,
                        onChange: function (e) {
                          var newSelected = {};
                          for (var key in selectedCounters) {
                            newSelected[key] = selectedCounters[key];
                          }
                          newSelected[type] = e.target.checked;
                          setSelectedCounters(newSelected);
                        },
                        disabled: submitting,
                        style: { cursor: "pointer" }
                      }),
                      React.createElement("span", null, type)
                    ),
                    selectedCounters[type] && React.createElement(
                      "div",
                      { style: { marginLeft: "24px", display: "flex", flexDirection: "column", gap: "4px" } },
                      React.createElement(
                        "div",
                        { className: "hint", style: { marginBottom: "0", fontSize: "11px" } },
                        "Номер прибора (необязательно)"
                      ),
                      React.createElement("input", {
                        className: "input",
                        type: "text",
                        placeholder: "Например: 12345678",
                        value: counterNumbers[type] || "",
                        onChange: function (e) {
                          var newNumbers = {};
                          for (var key in counterNumbers) {
                            newNumbers[key] = counterNumbers[key];
                          }
                          newNumbers[type] = e.target.value;
                          setCounterNumbers(newNumbers);
                        },
                        disabled: submitting,
                        style: { fontSize: "12px" }
                      }),
                      React.createElement("input", {
                        className: "input",
                        type: "text",
                        placeholder: "Комментарий по счётчику (опц.)",
                        value: counterComments[type] || "",
                        onChange: function (e) {
                          var newComments = {};
                          for (var key in counterComments) {
                            newComments[key] = counterComments[key];
                          }
                          newComments[type] = e.target.value;
                          setCounterComments(newComments);
                        },
                        disabled: submitting,
                        style: { fontSize: "12px" }
                      }),
                      React.createElement(
                        "select",
                        {
                          className: "input",
                          value: counterOperators[type] || "",
                          onChange: function (e) {
                            var newOps = {};
                            for (var key in counterOperators) {
                              newOps[key] = counterOperators[key];
                            }
                            newOps[type] = e.target.value;
                            setCounterOperators(newOps);
                          },
                          disabled: submitting,
                          style: { fontSize: "12px" }
                        },
                        React.createElement("option", { value: "" }, "Оператор не выбран"),
                        (props.operators || []).map(function (op) {
                          return React.createElement(
                            "option",
                            { key: op.id, value: op.id },
                            op.name
                          );
                        })
                      ),
                      React.createElement(
                        "div",
                        { className: "hint", style: { marginBottom: "0", fontSize: "11px" } },
                        "Вход в личный кабинет"
                      ),
                      React.createElement("input", {
                        className: "input",
                        type: "text",
                        placeholder: "Ссылка на ЛК (опц.)",
                        value: counterLkUrl[type] || "",
                        onChange: function (e) {
                          var updated = {};
                          for (var key in counterLkUrl) {
                            updated[key] = counterLkUrl[key];
                          }
                          updated[type] = e.target.value;
                          setCounterLkUrl(updated);
                        },
                        disabled: submitting,
                        style: { fontSize: "12px" }
                      }),
                      React.createElement("input", {
                        className: "input",
                        type: "text",
                        placeholder: "Логин ЛК (опц.)",
                        value: counterLkLogin[type] || "",
                        onChange: function (e) {
                          var updated = {};
                          for (var key in counterLkLogin) {
                            updated[key] = counterLkLogin[key];
                          }
                          updated[type] = e.target.value;
                          setCounterLkLogin(updated);
                        },
                        disabled: submitting,
                        style: { fontSize: "12px" }
                      }),
                      React.createElement("input", {
                        className: "input",
                        type: "text",
                        placeholder: "Пароль ЛК (опц.)",
                        value: counterLkPassword[type] || "",
                        onChange: function (e) {
                          var updated = {};
                          for (var key in counterLkPassword) {
                            updated[key] = counterLkPassword[key];
                          }
                          updated[type] = e.target.value;
                          setCounterLkPassword(updated);
                        },
                        disabled: submitting,
                        style: { fontSize: "12px" }
                      }),
                      React.createElement("input", {
                        className: "input",
                        type: "text",
                        placeholder: "Комментарий ЛК (опц.)",
                        value: counterLkComment[type] || "",
                        onChange: function (e) {
                          var updated = {};
                          for (var key in counterLkComment) {
                            updated[key] = counterLkComment[key];
                          }
                          updated[type] = e.target.value;
                          setCounterLkComment(updated);
                        },
                        disabled: submitting,
                        style: { fontSize: "12px" }
                      }),
                      React.createElement(
                        "div",
                        { className: "hint", style: { marginBottom: "0", fontSize: "11px" } },
                        "Дата поверки"
                      ),
                      React.createElement("input", {
                        className: "input",
                        type: "date",
                        value: counterVerificationDates[type] || "",
                        onChange: function (e) {
                          var updated = {};
                          for (var key in counterVerificationDates) {
                            updated[key] = counterVerificationDates[key];
                          }
                          updated[type] = e.target.value;
                          setCounterVerificationDates(updated);
                        },
                        disabled: submitting,
                        style: { fontSize: "12px" }
                      }),
                      React.createElement(
                        "div",
                        { className: "hint", style: { marginBottom: "0", fontSize: "11px" } },
                        "Действует до"
                      ),
                      React.createElement("input", {
                        className: "input",
                        type: "date",
                        value: counterValidUntil[type] || "",
                        onChange: function (e) {
                          var updated = {};
                          for (var key in counterValidUntil) {
                            updated[key] = counterValidUntil[key];
                          }
                          updated[type] = e.target.value;
                          setCounterValidUntil(updated);
                        },
                        disabled: submitting,
                        style: { fontSize: "12px" }
                      })
                    )
                  );
                })(counterType);
              })
            )
          ),
          React.createElement("div", { className: "divider" }),
          React.createElement(
            "button",
            {
              className: "button",
              type: "submit",
              disabled: submitting,
            },
            submitting ? "Сохранение..." : "Сохранить изменения"
          )
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "10px" } },
          React.createElement(
            "button",
            {
              className: "button button-secondary",
              type: "button",
              onClick: handleGoToReadings,
              style: { width: "100%" },
            },
            "Перейти к редактированию показаний →"
          ),
          React.createElement(
            "button",
            {
              className: "button",
              type: "button",
              onClick: handleArchiveObject,
              disabled: submitting,
              style: { 
                width: "100%", 
                background: "linear-gradient(135deg, #dc2626, #991b1b)", 
                borderColor: "rgba(248, 113, 113, 0.9)" 
              },
            },
            submitting ? "Архивирование..." : "📦 Перенести в архив"
          )
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          ),
        success &&
          React.createElement(
            "div",
            { className: "alert alert-success" },
            React.createElement("div", { className: "alert-icon" }, "✓"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement(
                "div",
                { className: "alert-title" },
                "Успешно"
              ),
              React.createElement(
                "div",
                { className: "alert-text" },
                successMessage || "Операция выполнена успешно."
              )
            )
          )
      );
    }

    if (step === "select-month") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setStep("edit");
                setError(null);
              },
            },
            "← К данным объекта"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Выбор месяца"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name
            )
          ),
          React.createElement("span", { className: "badge" }, "Показания счётчиков")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "field-label" },
            "Выберите месяц",
            React.createElement("span", null, "*")
          ),
          React.createElement(
            "div",
            { className: "hint", style: { marginBottom: "8px" } },
            "Будут показаны все показания счётчиков за выбранный месяц"
          ),
          React.createElement("input", {
            className: "input",
            type: "month",
            required: true,
            value: selectedMonth,
            onChange: function (e) {
              setSelectedMonth(e.target.value);
            },
            disabled: submitting,
          }),
          React.createElement(
            "button",
            {
              className: "button",
              type: "button",
              onClick: handleMonthSelect,
              disabled: submitting || !selectedMonth,
            },
            submitting ? "Загрузка..." : "Показать показания"
          )
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          )
      );
    }

    if (step === "edit-readings") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setEditedReadings({});
                setEditedDates({});
                setStep("select-month");
                setError(null);
                setSuccess(false);
              },
            },
            "← Выбрать другой месяц"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Редактирование показаний"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name + " • " + selectedMonth
            )
          ),
          React.createElement("span", { className: "badge" }, "Всего записей: " + readings.length)
        ),
        React.createElement("div", { className: "divider" }),
        readings.length > 0
          ? React.createElement(
              "div",
              null,
              React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: "12px" } },
                readings.map(function (reading) {
                  var readingId = reading.id;
                  var counterType = reading.counter_type;
                  var counterNumber = reading.counter_number;
                  var originalDate = reading.reading_date;
                  var originalValue = reading.indication;
                  
                  return React.createElement(
                    "div",
                    {
                      key: readingId,
                      style: {
                        padding: "12px",
                        border: "1px solid rgba(148, 163, 184, 0.3)",
                        borderRadius: "10px",
                      },
                    },
                    React.createElement(
                      "div",
                      { className: "field-label" },
                      counterType,
                      counterNumber ? " • № " + counterNumber : ""
                    ),
                    React.createElement(
                      "div",
                      { style: { display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px", marginTop: "6px" } },
                      React.createElement(
                        "div",
                        null,
                        React.createElement(
                          "div",
                          { className: "field-label", style: { fontSize: "11px", marginBottom: "4px" } },
                          "Дата"
                        ),
                        React.createElement("input", {
                          className: "input",
                          type: "date",
                          value: editedDates[readingId] !== undefined 
                            ? editedDates[readingId] 
                            : originalDate,
                          onChange: (function(id) {
                            return function(e) {
                              handleDateChange(id, e.target.value);
                            };
                          })(readingId),
                          disabled: submitting,
                          style: { fontSize: "12px" },
                        })
                      ),
                      React.createElement(
                        "div",
                        null,
                        React.createElement(
                          "div",
                          { className: "field-label", style: { fontSize: "11px", marginBottom: "4px" } },
                          "Показание"
                        ),
                        React.createElement("input", {
                          className: "input",
                          type: "number",
                          step: "0.01",
                          placeholder: "Введите показание",
                          value: editedReadings[readingId] !== undefined 
                            ? editedReadings[readingId] 
                            : originalValue,
                          onChange: (function(id) {
                            return function(e) {
                              handleReadingChange(id, e.target.value);
                            };
                          })(readingId),
                          disabled: submitting,
                        })
                      )
                    )
                  );
                })
              ),
              React.createElement(
                "button",
                {
                  className: "button",
                  type: "button",
                  onClick: handleSaveReadings,
                  disabled: submitting,
                  style: { marginTop: "12px" },
                },
                submitting ? "Сохранение..." : "Сохранить изменения"
              )
            )
          : React.createElement(
              "div",
              { className: "alert alert-info" },
              React.createElement("div", { className: "alert-icon" }, "i"),
              React.createElement(
                "div",
                { className: "alert-body" },
                React.createElement(
                  "div",
                  { className: "alert-title" },
                  "Нет показаний"
                ),
                React.createElement(
                  "div",
                  { className: "alert-text" },
                  "За выбранный месяц нет внесённых показаний."
                )
              )
            ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          ),
        success &&
          React.createElement(
            "div",
            { className: "alert alert-success" },
            React.createElement("div", { className: "alert-icon" }, "✓"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement(
                "div",
                { className: "alert-title" },
                "Сохранено"
              ),
              React.createElement(
                "div",
                { className: "alert-text" },
                "Показания успешно обновлены."
              )
            )
          )
      );
    }
  }

  function OperatorsScreen(props) {
    var operatorsState = useState([]);
    var operators = operatorsState[0];
    var setOperators = operatorsState[1];

    var ownersState = useState([]);
    var owners = ownersState[0];
    var setOwners = ownersState[1];

    // Карты выбранных операторов и владельцев: { id: true }
    var selectedOperatorIdsState = useState({});
    var selectedOperatorIds = selectedOperatorIdsState[0];
    var setSelectedOperatorIds = selectedOperatorIdsState[1];

    var selectedOwnerIdsState = useState({});
    var selectedOwnerIds = selectedOwnerIdsState[0];
    var setSelectedOwnerIds = selectedOwnerIdsState[1];

    var objectsState = useState([]);
    var objects = objectsState[0];
    var setObjects = objectsState[1];

    var loadingState = useState(false);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    // Счётчики по объектам (когда объекты загружены без счётчиков — сценарии 1 и 2)
    var countersByObjectIdState = useState({});
    var countersByObjectId = countersByObjectIdState[0];
    var setCountersByObjectId = countersByObjectIdState[1];

    // Статистика за последние 2 месяца: counterId -> { month1Label, month2Label, month1, month2, consumption1, consumption2, totalConsumption }
    var twoMonthsStatsState = useState({});
    var twoMonthsStats = twoMonthsStatsState[0];
    var setTwoMonthsStats = twoMonthsStatsState[1];
    var expandedCountersState = useState({});
    var expandedCounters = expandedCountersState[0];
    var setExpandedCounters = expandedCountersState[1];

    useEffect(function () {
      // Загружаем операторов
      supabase
        .from("operators")
        .select("id, name, sort_order")
        .eq("is_active", true)
        .order("sort_order")
        .then(function (res) {
          if (!res.error && res.data) setOperators(res.data);
        });

      // Загружаем владельцев объектов
      supabase
        .from("owners")
        .select("id, name, sort_order")
        .eq("is_active", true)
        .order("sort_order")
        .then(function (res) {
          if (!res.error && res.data) setOwners(res.data);
        });
    }, []);

    useEffect(function () {
      setLoading(true);
      setError(null);
      setObjects([]);

      // Получаем списки выбраных ID
      var activeOperatorIds = Object.keys(selectedOperatorIds).filter(function (id) { return selectedOperatorIds[id]; });
      var activeOwnerIds = Object.keys(selectedOwnerIds).filter(function (id) { return selectedOwnerIds[id]; });

      var hasOperatorFilter = activeOperatorIds.length > 0;
      var hasOwnerFilter = activeOwnerIds.length > 0;

      // Сценарий 1: нет фильтров — показываем все объекты
      if (!hasOperatorFilter && !hasOwnerFilter) {
        supabase
          .from("objects")
          .select("id, object_name, object_address")
          .eq("is_active", true)
          .order("object_name")
          .then(function (res) {
            setLoading(false);
            if (res.error) { setError("Ошибка загрузки объектов"); return; }
            setObjects(res.data || []);
          });
        return;
      }

      // Сценарий 2: фильтр только по владельцам
      if (!hasOperatorFilter && hasOwnerFilter) {
        var q = supabase
          .from("objects")
          .select("id, object_name, object_address, owner_id")
          .eq("is_active", true);

        q = q.in("owner_id", activeOwnerIds);

        q.order("object_name")
          .then(function (res) {
            setLoading(false);
            if (res.error) { setError("Ошибка загрузки объектов"); return; }
            setObjects(res.data || []);
          });
        return;
      }

      // Сценарий 3: есть фильтр по операторам (возможно, вместе с владельцами)
      supabase
        .from("counters")
        .select("id, object_id, counter_type, counter_number, lk_url, lk_login, lk_password, lk_comment, objects(id, object_name, object_address, is_active, owner_id)")
        .in("operator_id", activeOperatorIds)
        .then(function (res) {
          setLoading(false);
          if (res.error) { setError("Ошибка загрузки данных"); return; }
          var data = res.data || [];
          // Группируем счётчики по объекту
          var objMap = {};
          for (var i = 0; i < data.length; i++) {
            var row = data[i];
            if (!row.objects || !row.objects.is_active) continue;
            // Если есть фильтр по владельцам — применяем его
            if (hasOwnerFilter) {
              var ownerIdStr = row.objects.owner_id ? String(row.objects.owner_id) : "";
              if (activeOwnerIds.indexOf(ownerIdStr) === -1) continue;
            }
            var oid = row.objects.id;
            if (!objMap[oid]) {
              objMap[oid] = {
                id: oid,
                object_name: row.objects.object_name,
                object_address: row.objects.object_address,
                counters: []
              };
            }
            objMap[oid].counters.push({
              id: row.id,
              counter_type: row.counter_type,
              counter_number: row.counter_number,
              lk_url: row.lk_url,
              lk_login: row.lk_login,
              lk_password: row.lk_password,
              lk_comment: row.lk_comment
            });
          }
          var result = Object.values(objMap).sort(function(a, b) {
            return (a.object_name || "").localeCompare(b.object_name || "", "ru");
          });
          setObjects(result);
        });
    }, [selectedOperatorIds, selectedOwnerIds]);

    // Загрузка счётчиков для объектов, у которых их ещё нет (сценарии "все объекты" и "только владельцы")
    useEffect(function () {
      if (!objects || objects.length === 0) {
        setCountersByObjectId({});
        setTwoMonthsStats({});
        return;
      }
      var hasCounters = objects[0].counters && objects[0].counters.length > 0 && objects[0].counters[0].id;
      if (hasCounters) {
        setCountersByObjectId({});
        loadTwoMonthsReadings(objects);
        return;
      }
      var objectIds = objects.map(function (o) { return o.id; });
      supabase
        .from("counters")
        .select("id, object_id, counter_type, counter_number, lk_url, lk_login, lk_password, lk_comment")
        .in("object_id", objectIds)
        .eq("is_active", true)
        .then(function (res) {
          if (res.error) return;
          var list = res.data || [];
          var byObj = {};
          for (var i = 0; i < list.length; i++) {
            var c = list[i];
            var oid = c.object_id;
            if (!byObj[oid]) byObj[oid] = [];
            byObj[oid].push({
              id: c.id,
              counter_type: c.counter_type,
              counter_number: c.counter_number,
              lk_url: c.lk_url,
              lk_login: c.lk_login,
              lk_password: c.lk_password,
              lk_comment: c.lk_comment
            });
          }
          setCountersByObjectId(byObj);
          var allCounters = [];
          objects.forEach(function (o) {
            (byObj[o.id] || []).forEach(function (c) { allCounters.push(c); });
          });
          loadTwoMonthsReadingsForCounters(allCounters);
        });
    }, [objects]);

    function getLastTwoMonthKeys() {
      var now = new Date();
      var m2 = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      var m1 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      var key2 = m2.getFullYear() + "-" + String(m2.getMonth() + 1).padStart(2, "0");
      var key1 = m1.getFullYear() + "-" + String(m1.getMonth() + 1).padStart(2, "0");
      var monthNames = { "01": "Янв", "02": "Фев", "03": "Мар", "04": "Апр", "05": "Май", "06": "Июн", "07": "Июл", "08": "Авг", "09": "Сен", "10": "Окт", "11": "Ноя", "12": "Дек" };
      return [
        { key: key2, label: monthNames[key2.slice(5, 7)] + " " + key2.slice(0, 4) },
        { key: key1, label: monthNames[key1.slice(5, 7)] + " " + key1.slice(0, 4) }
      ];
    }

    function loadTwoMonthsReadings(objectsWithCounters) {
      var counterList = [];
      objectsWithCounters.forEach(function (o) {
        (o.counters || []).forEach(function (c) { if (c.id) counterList.push(c); });
      });
      loadTwoMonthsReadingsForCounters(counterList);
    }

    function loadTwoMonthsReadingsForCounters(counterList) {
      if (counterList.length === 0) {
        setTwoMonthsStats({});
        return;
      }
      var months = getLastTwoMonthKeys();
      var startDate = months[0].key + "-01";
      var endYear = parseInt(months[1].key.slice(0, 4), 10);
      var endMonth = parseInt(months[1].key.slice(5, 7), 10);
      var nextMonth = endMonth === 12 ? 1 : endMonth + 1;
      var nextYear = endMonth === 12 ? endYear + 1 : endYear;
      var endDate = nextYear + "-" + String(nextMonth).padStart(2, "0") + "-01";
      var counterIds = counterList.map(function (c) { return c.id; });

      supabase
        .from("meter_readings")
        .select("counter_id, reading_date, indication")
        .in("counter_id", counterIds)
        .gte("reading_date", startDate)
        .lt("reading_date", endDate)
        .then(function (res) {
          if (res.error) { setTwoMonthsStats({}); return; }
          var readings = res.data || [];
          var months = getLastTwoMonthKeys();
          var key1 = months[0].key;
          var key2 = months[1].key;
          var byCounter = {};
          counterIds.forEach(function (cid) {
            byCounter[cid] = { month1: null, month2: null, consumption1: null, consumption2: null, totalConsumption: null };
          });
          readings.forEach(function (r) {
            var cid = r.counter_id;
            if (!byCounter[cid]) byCounter[cid] = { month1: null, month2: null, consumption1: null, consumption2: null, totalConsumption: null };
            var monthKey = r.reading_date.slice(0, 7);
            var val = r.indication;
            var date = r.reading_date;
            if (monthKey === key1) {
              if (!byCounter[cid].month1 || r.reading_date > byCounter[cid].month1.date) {
                byCounter[cid].month1 = { value: val, date: date };
              }
            } else if (monthKey === key2) {
              if (!byCounter[cid].month2 || r.reading_date > byCounter[cid].month2.date) {
                byCounter[cid].month2 = { value: val, date: date };
              }
            }
          });
          Object.keys(byCounter).forEach(function (cid) {
            var d = byCounter[cid];
            if (d.month1 && d.month2) {
              d.consumption2 = d.month2.value - d.month1.value;
              d.consumption1 = null;
              d.totalConsumption = d.consumption2;
            } else if (d.month1) {
              d.consumption1 = null;
              d.consumption2 = null;
              d.totalConsumption = null;
            } else if (d.month2) {
              d.consumption1 = null;
              d.consumption2 = null;
              d.totalConsumption = null;
            }
          });
          setTwoMonthsStats(byCounter);
        });
    }

    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "button",
          { className: "button-ghost", style: { marginBottom: "12px" }, onClick: function () { props.onNavigate("menu"); } },
          "← Назад в меню"
        ),
        React.createElement("div", { className: "panel-title" }, "Операторы"),
        React.createElement("div", { className: "panel-subtitle" }, "Просмотр объектов по обслуживающим организациям")
      ),
      // Фильтры операторов
      React.createElement(
        "div",
        { style: { marginBottom: "10px" } },
        React.createElement(
          "div",
          { style: { fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" } },
          "Фильтр по операторам"
        ),
        React.createElement(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
          React.createElement(
            "button",
            {
              className: "button-ghost",
              style: {
                padding: "6px 14px",
                borderRadius: "20px",
                cursor: "pointer",
              },
              onClick: function () { setSelectedOperatorIds({}); }
            },
            "Все операторы"
          ),
          operators.map(function (op) {
            var isActive = !!selectedOperatorIds[op.id];
            return React.createElement(
              "button",
              {
                key: op.id,
                style: {
                  padding: "6px 14px",
                  borderRadius: "20px",
                  cursor: "pointer",
                  fontWeight: isActive ? "600" : "normal",
                  background: isActive ? "var(--accent)" : "transparent",
                  color: isActive ? "#fff" : "var(--text-muted)",
                  border: isActive ? "none" : "1px solid rgba(148,163,184,0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                },
                onClick: function () {
                  var updated = {};
                  for (var key in selectedOperatorIds) updated[key] = selectedOperatorIds[key];
                  if (updated[op.id]) {
                    delete updated[op.id];
                  } else {
                    updated[op.id] = true;
                  }
                  setSelectedOperatorIds(updated);
                }
              },
              React.createElement(
                "span",
                {
                  style: {
                    width: "10px",
                    height: "10px",
                    borderRadius: "3px",
                    border: "1px solid rgba(148,163,184,0.7)",
                    background: isActive ? "var(--accent)" : "transparent"
                  }
                }
              ),
              op.name
            );
          })
        )
      ),
      // Фильтры владельцев
      React.createElement(
        "div",
        { style: { marginBottom: "16px" } },
        React.createElement(
          "div",
          { style: { fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" } },
          "Фильтр по владельцам (собственникам)"
        ),
        React.createElement(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: "8px" } },
          React.createElement(
            "button",
            {
              className: "button-ghost",
              style: {
                padding: "6px 14px",
                borderRadius: "20px",
                cursor: "pointer",
              },
              onClick: function () { setSelectedOwnerIds({}); }
            },
            "Все владельцы"
          ),
          owners.map(function (owner) {
            var isActiveOwner = !!selectedOwnerIds[owner.id];
            return React.createElement(
              "button",
              {
                key: owner.id,
                style: {
                  padding: "6px 14px",
                  borderRadius: "20px",
                  cursor: "pointer",
                  fontWeight: isActiveOwner ? "600" : "normal",
                  background: isActiveOwner ? "var(--accent)" : "transparent",
                  color: isActiveOwner ? "#fff" : "var(--text-muted)",
                  border: isActiveOwner ? "none" : "1px solid rgba(148,163,184,0.3)",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                },
                onClick: function () {
                  var updated = {};
                  for (var key in selectedOwnerIds) updated[key] = selectedOwnerIds[key];
                  if (updated[owner.id]) {
                    delete updated[owner.id];
                  } else {
                    updated[owner.id] = true;
                  }
                  setSelectedOwnerIds(updated);
                }
              },
              React.createElement(
                "span",
                {
                  style: {
                    width: "10px",
                    height: "10px",
                    borderRadius: "3px",
                    border: "1px solid rgba(148,163,184,0.7)",
                    background: isActiveOwner ? "var(--accent)" : "transparent"
                  }
                }
              ),
              owner.name
            );
          })
        )
      ),
      // Заголовок результатов
      React.createElement(
        "div",
        { style: { fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" } },
        loading
          ? "Загрузка..."
          : "Найдено объектов: " + objects.length
      ),
      error && React.createElement("div", { className: "alert alert-error", style: { marginBottom: "12px" } },
        React.createElement("div", { className: "alert-text" }, error)
      ),
      // Список объектов
      !loading && objects.length === 0 && !error && React.createElement(
        "div",
        { style: { color: "var(--text-muted)", textAlign: "center", padding: "32px 0", fontSize: "14px" } },
        "Нет объектов по выбранным фильтрам"
      ),
      objects.map(function (obj) {
        var countersList = obj.counters && obj.counters.length > 0 ? obj.counters : (countersByObjectId[obj.id] || []);
        var monthLabels = getLastTwoMonthKeys();
        return React.createElement(
          "div",
          {
            key: obj.id,
            style: {
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(148,163,184,0.15)",
              borderRadius: "10px",
              padding: "12px 14px",
              marginBottom: "8px"
            }
          },
          React.createElement(
            "div",
            { style: { fontWeight: "600", fontSize: "14px", marginBottom: "2px" } },
            obj.object_name || "—"
          ),
          React.createElement(
            "div",
            { style: { fontSize: "12px", color: "var(--text-muted)" } },
            obj.object_address || ""
          ),
          countersList.length > 0 && React.createElement(
            "div",
            { style: { marginTop: "6px", display: "flex", flexWrap: "wrap", gap: "6px" } },
            countersList.map(function (c, idx) {
              return React.createElement(
                "span",
                {
                  key: c.id || idx,
                  style: {
                    background: "rgba(59,130,246,0.15)",
                    border: "1px solid rgba(59,130,246,0.3)",
                    borderRadius: "6px",
                    padding: "2px 8px",
                    fontSize: "11px",
                    color: "rgba(147,197,253,1)"
                  }
                },
                c.counter_type,
                c.counter_number ? " · " + c.counter_number : ""
              );
            })
          ),
          countersList.length > 0 && React.createElement(
            "div",
            { style: { marginTop: "12px", fontSize: "12px" } },
            React.createElement(
              "div",
              { style: { color: "var(--text-muted)", marginBottom: "6px", fontWeight: "600" } },
              "Последние 2 месяца"
            ),
            React.createElement(
              "div",
              { style: { overflowX: "auto" } },
              React.createElement(
                "table",
                { style: { width: "100%", borderCollapse: "collapse", fontSize: "11px" } },
                React.createElement(
                  "thead",
                  null,
                  React.createElement(
                    "tr",
                    null,
                    React.createElement("th", { style: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid rgba(148,163,184,0.3)" } }, "Счётчик"),
                    React.createElement("th", { style: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid rgba(148,163,184,0.3)" } }, monthLabels[0].label),
                    React.createElement("th", { style: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid rgba(148,163,184,0.3)" } }, monthLabels[1].label),
                    React.createElement("th", { style: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid rgba(148,163,184,0.3)" } }, "Итого расход")
                  )
                ),
                React.createElement(
                  "tbody",
                  null,
                  countersList.map(function (c) {
                    var stats = twoMonthsStats[c.id] || {};
                    var m1 = stats.month1;
                    var m2 = stats.month2;
                    var total = stats.totalConsumption != null ? Number(stats.totalConsumption).toFixed(3) : "—";
                    var isExpanded = !!expandedCounters[c.id];
                    var hasLkData = !!(c.lk_url || c.lk_login || c.lk_password || c.lk_comment);
                    var fmt = function (d) {
                      if (!d || !d.date) return "—";
                      var p = d.date.split("-");
                      return (p[2] || "") + "." + (p[1] || "") + "." + (p[0] || "");
                    };
                    return React.createElement(
                      React.Fragment,
                      { key: c.id },
                      React.createElement(
                        "tr",
                        null,
                        React.createElement(
                          "td",
                          { style: { padding: "6px 8px", borderBottom: "1px solid rgba(148,163,184,0.15)", whiteSpace: "nowrap" } },
                          hasLkData ? React.createElement(
                            "button",
                            {
                              type: "button",
                              onClick: function () {
                                var next = {};
                                for (var key in expandedCounters) next[key] = expandedCounters[key];
                                next[c.id] = !expandedCounters[c.id];
                                setExpandedCounters(next);
                              },
                              style: {
                                marginRight: "6px",
                                background: "transparent",
                                border: "none",
                                color: "var(--text-muted)",
                                cursor: "pointer"
                              }
                            },
                            isExpanded ? "▾" : "▸"
                          ) : React.createElement("span", { style: { display: "inline-block", width: "18px", marginRight: "6px" } }),
                          c.counter_type + (c.counter_number ? " № " + c.counter_number : "")
                        ),
                        React.createElement(
                          "td",
                          { style: { padding: "6px 8px", borderBottom: "1px solid rgba(148,163,184,0.15)" } },
                          m1 ? React.createElement("div", null, m1.value, React.createElement("div", { style: { fontSize: "10px", color: "var(--text-muted)" } }, fmt(m1))) : "—"
                        ),
                        React.createElement(
                          "td",
                          { style: { padding: "6px 8px", borderBottom: "1px solid rgba(148,163,184,0.15)" } },
                          m2 ? React.createElement("div", null, m2.value, React.createElement("div", { style: { fontSize: "10px", color: "var(--text-muted)" } }, fmt(m2))) : "—"
                        ),
                        React.createElement(
                          "td",
                          { style: { padding: "6px 8px", borderBottom: "1px solid rgba(148,163,184,0.15)", color: total !== "—" ? "rgba(74,222,128,0.9)" : "inherit" } },
                          total
                        )
                      ),
                      isExpanded && hasLkData &&
                        React.createElement(
                          "tr",
                          null,
                          React.createElement(
                            "td",
                            {
                              colSpan: 4,
                              style: {
                                padding: "8px 8px 10px 32px",
                                borderBottom: "1px solid rgba(148,163,184,0.15)",
                                background: "rgba(15,23,42,0.7)"
                              }
                            },
                            React.createElement(
                              "div",
                              { style: { display: "flex", flexDirection: "column", gap: "4px" } },
                              React.createElement(
                                "div",
                                { style: { fontSize: "11px", color: "var(--text-muted)" } },
                                "Вход в личный кабинет"
                              ),
                              React.createElement(
                                "div",
                                { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: "6px" } },
                                React.createElement(
                                  "div",
                                  null,
                                  React.createElement(
                                    "div",
                                    { style: { fontSize: "10px", color: "var(--text-muted)", marginBottom: "2px" } },
                                    "Ссылка"
                                  ),
                                  React.createElement("input", {
                                    className: "input",
                                    type: "text",
                                    readOnly: true,
                                    value: c.lk_url || "",
                                    style: { fontSize: "11px", opacity: c.lk_url ? 1 : 0.5 }
                                  })
                                ),
                                React.createElement(
                                  "div",
                                  null,
                                  React.createElement(
                                    "div",
                                    { style: { fontSize: "10px", color: "var(--text-muted)", marginBottom: "2px" } },
                                    "Логин"
                                  ),
                                  React.createElement("input", {
                                    className: "input",
                                    type: "text",
                                    readOnly: true,
                                    value: c.lk_login || "",
                                    style: { fontSize: "11px", opacity: c.lk_login ? 1 : 0.5 }
                                  })
                                ),
                                React.createElement(
                                  "div",
                                  null,
                                  React.createElement(
                                    "div",
                                    { style: { fontSize: "10px", color: "var(--text-muted)", marginBottom: "2px" } },
                                    "Пароль"
                                  ),
                                  React.createElement("input", {
                                    className: "input",
                                    type: "text",
                                    readOnly: true,
                                    value: c.lk_password || "",
                                    style: { fontSize: "11px", opacity: c.lk_password ? 1 : 0.5 }
                                  })
                                )
                              ),
                              React.createElement(
                                "div",
                                { style: { marginTop: "6px" } },
                                React.createElement(
                                  "div",
                                  { style: { fontSize: "10px", color: "var(--text-muted)", marginBottom: "2px" } },
                                  "Комментарий"
                                ),
                                React.createElement("input", {
                                  className: "input",
                                  type: "text",
                                  readOnly: true,
                                  value: c.lk_comment || "",
                                  style: { fontSize: "11px", opacity: c.lk_comment ? 1 : 0.5 }
                                })
                              )
                            )
                          )
                        )
                    );
                  })
                )
              )
            )
          )
        );
      })
    );
  }

  function ArchiveScreen(props) {
    var categoryState = useState("objects");
    var category = categoryState[0];
    var setCategory = categoryState[1];

    var objectsState = useState([]);
    var objects = objectsState[0];
    var setObjects = objectsState[1];

    var usersState = useState([]);
    var users = usersState[0];
    var setUsers = usersState[1];

    var selectedObjectState = useState(null);
    var selectedObject = selectedObjectState[0];
    var setSelectedObject = selectedObjectState[1];

    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    var stepState = useState("list");
    var step = stepState[0];
    var setStep = stepState[1];

    var objectNameState = useState("");
    var objectName = objectNameState[0];
    var setObjectName = objectNameState[1];

    var objectAddressState = useState("");
    var objectAddress = objectAddressState[0];
    var setObjectAddress = objectAddressState[1];

    var areaState = useState("");
    var area = areaState[0];
    var setArea = areaState[1];

    var contactsState = useState("");
    var contacts = contactsState[0];
    var setContacts = contactsState[1];

    var commentsState = useState("");
    var comments = commentsState[0];
    var setComments = commentsState[1];

    var submittingState = useState(false);
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    var successState = useState(false);
    var success = successState[0];
    var setSuccess = successState[1];

    var archiveSearchState = useState("");
    var archiveSearch = archiveSearchState[0];
    var setArchiveSearch = archiveSearchState[1];

    var archiveAssignedMapState = useState({});
    var archiveAssignedMap = archiveAssignedMapState[0];
    var setArchiveAssignedMap = archiveAssignedMapState[1];

    useEffect(function () {
      if (category === "objects") loadArchiveObjects();
      else loadArchiveUsers();
    }, [category]);

    function loadArchiveObjects() {
      setLoading(true);
      setError(null);

      supabase
        .from("objects")
        .select("*")
        .eq("is_active", false)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Ошибка загрузки архивных объектов");
            setLoading(false);
            return;
          }

          var sorted = result.data.sort(function (a, b) {
            var nameA = (a.object_name || "").toLowerCase();
            var nameB = (b.object_name || "").toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
          });

          setObjects(sorted);
          setLoading(false);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке архива");
          setLoading(false);
        });
    }

    function loadArchiveUsers() {
      setLoading(true);
      setError(null);
      setArchiveAssignedMap({});
      supabase
        .from("employees")
        .select("id, email, first_name, last_name, role, max_id, phone")
        .eq("is_active", false)
        .then(function (result) {
          if (result.error) {
            console.warn("Archive users with max_id/phone failed:", result.error.message);
            return supabase
              .from("employees")
              .select("id, email, first_name, last_name, role")
              .eq("is_active", false);
          }
          return { data: result.data };
        })
        .then(function (res) {
          var data = res && res.data ? res.data : (res && !res.error ? res.data : null);
          if (!data) {
            setUsers([]);
            if (res && res.error) {
              console.error(res.error);
              setError("Ошибка загрузки деактивированных пользователей");
            }
            setLoading(false);
            return;
          }
          var sorted = data.slice().sort(function (a, b) {
            var nameA = ((a.first_name || "") + " " + (a.last_name || "")).toLowerCase();
            var nameB = ((b.first_name || "") + " " + (b.last_name || "")).toLowerCase();
            return nameA.localeCompare(nameB);
          });
          setUsers(sorted);
          var ids = sorted.map(function (e) { return e.id; });
          if (ids.length === 0) {
            setLoading(false);
            return;
          }
          return supabase
            .from("objects")
            .select("object_name, object_address, assigned_employee_id")
            .eq("is_active", true)
            .in("assigned_employee_id", ids);
        })
        .then(function (objRes) {
          if (objRes && objRes.data) {
            var map = {};
            objRes.data.forEach(function (o) {
              var eid = o.assigned_employee_id;
              if (!map[eid]) map[eid] = [];
              map[eid].push({ name: o.object_name || "", address: o.object_address || "" });
            });
            setArchiveAssignedMap(map);
          }
          setLoading(false);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при загрузке архива пользователей");
          setLoading(false);
        });
    }

    function handleActivateUser(emp) {
      if (!confirm("Активировать пользователя \"" + (emp.first_name || "") + " " + (emp.last_name || "") + "\" (" + (emp.email || "") + ")?")) return;
      setError(null);
      supabase
        .from("employees")
        .update({ is_active: true })
        .eq("id", emp.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось активировать пользователя: " + result.error.message);
            return;
          }
          loadArchiveUsers();
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при активации пользователя.");
        });
    }

    function handleSelectObject(obj) {
      setSelectedObject(obj);
      setObjectName(obj.object_name || "");
      setObjectAddress(obj.object_address || "");
      setArea(obj.area ? String(obj.area) : "");
      setContacts(obj.contacts || "");
      setComments(obj.comments || "");
      setStep("view");
      setError(null);
      setSuccess(false);
    }

    function handleUpdateObject(e) {
      e.preventDefault();
      setError(null);
      setSuccess(false);

      if (!objectName.trim() || !objectAddress.trim()) {
        setError("Название и адрес объекта обязательны.");
        return;
      }

      setSubmitting(true);

      var updateData = {
        object_name: objectName.trim(),
        object_address: objectAddress.trim(),
        area: area.trim() ? parseFloat(area) : null,
        contacts: contacts.trim() || null,
        comments: comments.trim() || null,
      };

      supabase
        .from("objects")
        .update(updateData)
        .eq("id", selectedObject.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось обновить объект: " + result.error.message);
            setSubmitting(false);
            return;
          }

          setSuccess(true);
          setSubmitting(false);
          setSelectedObject(Object.assign({}, selectedObject, updateData));
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при обновлении объекта");
          setSubmitting(false);
        });
    }

    function handleReactivate() {
      if (!confirm("Восстановить объект \"" + selectedObject.object_name + "\" из архива?")) {
        return;
      }

      setError(null);
      setSuccess(false);
      setSubmitting(true);

      supabase
        .from("objects")
        .update({ is_active: true })
        .eq("id", selectedObject.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось восстановить объект: " + result.error.message);
            setSubmitting(false);
            return;
          }

          setSuccess(true);
          setSubmitting(false);
          
          setTimeout(function() {
            setStep("list");
            setSelectedObject(null);
            loadArchiveObjects();
          }, 1000);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при восстановлении объекта");
          setSubmitting(false);
        });
    }

    if (step === "list") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                props.onNavigate("menu");
              },
            },
            "← Назад в меню"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Архив"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              "Объекты и пользователи — восстановление из архива"
            )
          ),
          React.createElement("span", { className: "badge" }, "Блок 05")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          { style: { display: "flex", gap: "8px", marginBottom: "16px" } },
          React.createElement(
            "button",
            {
              type: "button",
              className: category === "objects" ? "button" : "button-secondary button",
              onClick: function () { setCategory("objects"); setError(null); },
            },
            "Объекты"
          ),
          React.createElement(
            "button",
            {
              type: "button",
              className: category === "users" ? "button" : "button-secondary button",
              onClick: function () { setCategory("users"); setError(null); },
            },
            "Пользователи"
          )
        ),
        !loading && React.createElement(
          "div",
          { style: { marginBottom: "16px" } },
          React.createElement("div", { className: "field-label", style: { marginBottom: "6px" } }, "Поиск"),
          React.createElement("div", { style: { display: "flex", gap: "8px" } },
            React.createElement("input", {
              className: "input",
              type: "text",
              placeholder: category === "objects" ? "Название или адрес объекта…" : "Имя, email, телефон, объект…",
              value: archiveSearch,
              onChange: function (e) { setArchiveSearch(e.target.value); },
            }),
            archiveSearch.trim() && React.createElement(
              "button",
              { type: "button", className: "button-secondary button", onClick: function () { setArchiveSearch(""); }, style: { marginTop: 0 } },
              "Очистить"
            )
          )
        ),
        loading
          ? React.createElement(
              "div",
              { className: "hint" },
              category === "objects" ? "⏳ Загрузка архивных объектов..." : "⏳ Загрузка деактивированных пользователей..."
            )
          : category === "users"
          ? (function () {
              var q = (archiveSearch || "").trim().toLowerCase();
              var filteredUsers = q
                ? users.filter(function (emp) {
                    var name = ((emp.first_name || "") + " " + (emp.last_name || "")).trim().toLowerCase();
                    var email = (emp.email || "").toLowerCase();
                    var roleStr = (emp.role === "owner" ? "владелец" : "пользователь");
                    var maxIdStr = (emp.max_id || "").toLowerCase();
                    var phoneStr = (emp.phone || "").replace(/\D/g, "");
                    var qDigits = q.replace(/\D/g, "");
                    if (name.indexOf(q) >= 0 || email.indexOf(q) >= 0 || roleStr.indexOf(q) >= 0 || maxIdStr.indexOf(q) >= 0) return true;
                    if (qDigits.length >= 3 && phoneStr.indexOf(qDigits) >= 0) return true;
                    var assigned = archiveAssignedMap[emp.id] || [];
                    for (var i = 0; i < assigned.length; i++) {
                      if ((assigned[i].name || "").toLowerCase().indexOf(q) >= 0 || (assigned[i].address || "").toLowerCase().indexOf(q) >= 0) return true;
                    }
                    return false;
                  })
                : users;
              return filteredUsers.length > 0
            ? React.createElement(
                "div",
                null,
                React.createElement(
                  "div",
                  { className: "field-label" },
                  q ? "Найдено пользователей: " + filteredUsers.length : "Деактивированных пользователей: " + users.length
                ),
                React.createElement(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" } },
                  filteredUsers.map(function (emp) {
                    return React.createElement(
                      "div",
                      {
                        key: emp.id,
                        className: "user-card",
                        style: { opacity: 0.9 },
                      },
                      React.createElement(
                        "div",
                        { className: "user-card-main" },
                        React.createElement(
                          "div",
                          { className: "user-meta" },
                          React.createElement(
                            "div",
                            { className: "user-name" },
                            ((emp.first_name || "") + " " + (emp.last_name || "")).trim() || "—"
                          ),
                          React.createElement(
                            "div",
                            { className: "user-role" },
                            emp.email || "—"
                          )
                        )
                      ),
                      React.createElement(
                        "button",
                        {
                          type: "button",
                          className: "button button-ghost",
                          onClick: function () { handleActivateUser(emp); },
                        },
                        "Активировать"
                      )
                    );
                  })
                )
              )
            : React.createElement(
                "div",
                { className: "alert alert-info" },
                React.createElement("div", { className: "alert-icon" }, "i"),
                React.createElement(
                  "div",
                  { className: "alert-body" },
                  React.createElement("div", { className: "alert-title" }, q ? "Никого не найдено" : "Нет деактивированных пользователей"),
                  React.createElement("div", { className: "alert-text" }, q ? "Измените запрос или очистите поиск." : "Все пользователи активны. Деактивация выполняется в разделе «Управление пользователями».")
                )
              );
            })()
          : (function() {
              var q = (archiveSearch || "").trim().toLowerCase();
              var filteredObjects = q
                ? objects.filter(function (obj) {
                    var name = (obj.object_name || "").toLowerCase();
                    var addr = (obj.object_address || "").toLowerCase();
                    var contacts = (obj.contacts || "").toLowerCase();
                    var comments = (obj.comments || "").toLowerCase();
                    var areaStr = (obj.area != null ? String(obj.area) : "").toLowerCase();
                    return name.indexOf(q) >= 0 || addr.indexOf(q) >= 0 || contacts.indexOf(q) >= 0 || comments.indexOf(q) >= 0 || areaStr.indexOf(q) >= 0;
                  })
                : objects;
              return filteredObjects.length > 0
          ? React.createElement(
              "div",
              null,
              React.createElement(
                "div",
                { className: "field-label" },
                q ? "Найдено объектов: " + filteredObjects.length : "Архивных объектов: " + objects.length + " (отсортированы по алфавиту)"
              ),
              React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" } },
                filteredObjects.map(function (obj) {
                  return React.createElement(
                    "div",
                    {
                      key: obj.id,
                      className: "user-card",
                      onClick: function () {
                        handleSelectObject(obj);
                      },
                      style: { cursor: "pointer", opacity: 0.8 },
                    },
                    React.createElement(
                      "div",
                      { className: "user-card-main" },
                      React.createElement(
                        "div",
                        { className: "user-meta" },
                        React.createElement(
                          "div",
                          { className: "user-name" },
                          obj.object_name
                        ),
                        React.createElement(
                          "div",
                          { className: "user-role" },
                          obj.object_address
                        )
                      )
                    ),
                    React.createElement(
                      "button",
                      {
                        className: "button-ghost",
                        type: "button",
                      },
                      "Просмотр →"
                    )
                  );
                })
              )
            )
          : React.createElement(
              "div",
              { className: "alert alert-info" },
              React.createElement("div", { className: "alert-icon" }, "i"),
              React.createElement(
                "div",
                { className: "alert-body" },
                React.createElement(
                  "div",
                  { className: "alert-title" },
                  (archiveSearch || "").trim() ? "Ничего не найдено" : "Архив пуст"
                ),
                React.createElement(
                  "div",
                  { className: "alert-text" },
                  (archiveSearch || "").trim() ? "Измените запрос или очистите поиск." : "В архиве нет объектов. Все объекты активны."
                )
              )
            );
          })(),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          )
      );
    }

    if (step === "view") {
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "top-bar" },
          React.createElement(
            "button",
            {
              className: "back-button",
              onClick: function () {
                setStep("list");
                setSelectedObject(null);
                setError(null);
                setSuccess(false);
              },
            },
            "← К списку архива"
          )
        ),
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              "Архивный объект"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              selectedObject.object_name
            )
          ),
          React.createElement("span", { className: "badge" }, "Неактивен")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "form",
          { className: "form", onSubmit: handleUpdateObject },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Название объекта",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "text",
              required: true,
              placeholder: "Название объекта",
              value: objectName,
              onChange: function (e) {
                setObjectName(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Адрес объекта",
              React.createElement("span", null, "*")
            ),
            React.createElement("input", {
              className: "input",
              type: "text",
              required: true,
              placeholder: "Адрес объекта",
              value: objectAddress,
              onChange: function (e) {
                setObjectAddress(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Площадь (м²)"
            ),
            React.createElement("input", {
              className: "input",
              type: "number",
              step: "0.01",
              placeholder: "Площадь объекта",
              value: area,
              onChange: function (e) {
                setArea(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Контакты"
            ),
            React.createElement("textarea", {
              className: "input",
              rows: 2,
              placeholder: "ФИО, телефон, email ответственного лица",
              value: contacts,
              onChange: function (e) {
                setContacts(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "field-label" },
              "Комментарии"
            ),
            React.createElement("textarea", {
              className: "input",
              rows: 2,
              placeholder: "Дополнительная информация",
              value: comments,
              onChange: function (e) {
                setComments(e.target.value);
              },
              disabled: submitting,
            })
          ),
          React.createElement(
            "button",
            {
              className: "button",
              type: "submit",
              disabled: submitting,
            },
            submitting ? "Сохранение..." : "Сохранить изменения"
          )
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "button",
          {
            className: "button button-secondary",
            type: "button",
            onClick: handleReactivate,
            disabled: submitting,
            style: { width: "100%", background: "linear-gradient(135deg, #22c55e, #16a34a)", borderColor: "rgba(74, 222, 128, 0.9)" },
          },
          submitting ? "Восстановление..." : "↻ Восстановить объект"
        ),
        error &&
          React.createElement(
            "div",
            { className: "alert alert-error" },
            React.createElement("div", { className: "alert-icon" }, "!"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement("div", { className: "alert-title" }, "Ошибка"),
              React.createElement("div", { className: "alert-text" }, error)
            )
          ),
        success &&
          React.createElement(
            "div",
            { className: "alert alert-success" },
            React.createElement("div", { className: "alert-icon" }, "✓"),
            React.createElement(
              "div",
              { className: "alert-body" },
              React.createElement(
                "div",
                { className: "alert-title" },
                "Успешно"
              ),
              React.createElement(
                "div",
                { className: "alert-text" },
                "Объект восстановлен и теперь активен."
              )
            )
          )
      );
    }
  }

  function UserManagementScreen(props) {
    var viewModeState = useState("create");
    var viewMode = viewModeState[0];
    var setViewMode = viewModeState[1];

    var emailState = useState("");
    var passwordState = useState("");
    var firstNameState = useState("");
    var lastNameState = useState("");
    var maxIdState = useState("");
    var phoneState = useState("");
    var notifyViaEmailState = useState(false);
    var notifyViaTelegramState = useState(false);
    var notifyViaMaxState = useState(false);
    var roleState = useState("user");
    var submittingState = useState(false);
    var errorState = useState(null);
    var successState = useState(null);
    var createdCredentialsState = useState(null);
    var objectsState = useState([]);
    var selectedObjectIdsState = useState({});
    var email = emailState[0];
    var setEmail = emailState[1];
    var password = passwordState[0];
    var setPassword = passwordState[1];
    var firstName = firstNameState[0];
    var setFirstName = firstNameState[1];
    var lastName = lastNameState[0];
    var setLastName = lastNameState[1];
    var maxId = maxIdState[0];
    var setMaxId = maxIdState[1];
    var phone = phoneState[0];
    var setPhone = phoneState[1];
    var notifyViaEmail = notifyViaEmailState[0];
    var setNotifyViaEmail = notifyViaEmailState[1];
    var notifyViaTelegram = notifyViaTelegramState[0];
    var setNotifyViaTelegram = notifyViaTelegramState[1];
    var notifyViaMax = notifyViaMaxState[0];
    var setNotifyViaMax = notifyViaMaxState[1];
    var role = roleState[0];
    var setRole = roleState[1];
    var submitting = submittingState[0];
    var setSubmitting = submittingState[1];
    var error = errorState[0];
    var setError = errorState[1];
    var success = successState[0];
    var setSuccess = successState[1];
    var createdCredentials = createdCredentialsState[0];
    var setCreatedCredentials = createdCredentialsState[1];
    var copiedToClipboardState = useState(false);
    var copiedToClipboard = copiedToClipboardState[0];
    var setCopiedToClipboard = copiedToClipboardState[1];
    var objects = objectsState[0];
    var setObjects = objectsState[1];
    var selectedObjectIds = selectedObjectIdsState[0];
    var setSelectedObjectIds = selectedObjectIdsState[1];

    var employeesListState = useState([]);
    var selectedEmployeeIdState = useState("");
    var editEmailState = useState("");
    var editPasswordState = useState("");
    var editFirstNameState = useState("");
    var editLastNameState = useState("");
    var editMaxIdState = useState("");
    var editPhoneState = useState("");
    var editNotifyViaEmailState = useState(false);
    var editNotifyViaTelegramState = useState(false);
    var editNotifyViaMaxState = useState(false);
    var editRoleState = useState("user");
    var editObjectsState = useState([]);
    var editSelectedObjectIdsState = useState({});
    var editSubmittingState = useState(false);
    var editErrorState = useState(null);
    var editSuccessState = useState(null);
    var editUserSearchState = useState("");
    var employeesList = employeesListState[0];
    var setEmployeesList = employeesListState[1];
    var selectedEmployeeId = selectedEmployeeIdState[0];
    var setSelectedEmployeeId = selectedEmployeeIdState[1];
    var editUserSearch = editUserSearchState[0];
    var setEditUserSearch = editUserSearchState[1];
    var editEmail = editEmailState[0];
    var setEditEmail = editEmailState[1];
    var editPassword = editPasswordState[0];
    var setEditPassword = editPasswordState[1];
    var editFirstName = editFirstNameState[0];
    var setEditFirstName = editFirstNameState[1];
    var editLastName = editLastNameState[0];
    var setEditLastName = editLastNameState[1];
    var editMaxId = editMaxIdState[0];
    var setEditMaxId = editMaxIdState[1];
    var editPhone = editPhoneState[0];
    var setEditPhone = editPhoneState[1];
    var editNotifyViaEmail = editNotifyViaEmailState[0];
    var setEditNotifyViaEmail = editNotifyViaEmailState[1];
    var editNotifyViaTelegram = editNotifyViaTelegramState[0];
    var setEditNotifyViaTelegram = editNotifyViaTelegramState[1];
    var editNotifyViaMax = editNotifyViaMaxState[0];
    var setEditNotifyViaMax = editNotifyViaMaxState[1];
    var editRole = editRoleState[0];
    var setEditRole = editRoleState[1];
    var editObjects = editObjectsState[0];
    var setEditObjects = editObjectsState[1];
    var editSelectedObjectIds = editSelectedObjectIdsState[0];
    var setEditSelectedObjectIds = editSelectedObjectIdsState[1];
    var editSubmitting = editSubmittingState[0];
    var setEditSubmitting = editSubmittingState[1];
    var editError = editErrorState[0];
    var setEditError = editErrorState[1];
    var editSuccess = editSuccessState[0];
    var setEditSuccess = editSuccessState[1];

    useEffect(function () {
      if (viewMode !== "create") return;
      supabase
        .from("objects")
        .select("id, object_name, object_address")
        .eq("is_active", true)
        .is("assigned_employee_id", null)
        .order("object_name")
        .then(function (res) {
          if (!res.error && res.data) setObjects(res.data);
        });
    }, [viewMode]);

    var assignedObjectsMapState = useState({});
    var assignedObjectsMap = assignedObjectsMapState[0];
    var setAssignedObjectsMap = assignedObjectsMapState[1];

    useEffect(function () {
      if (viewMode !== "edit") return;
      supabase
        .from("employees")
        .select("id, email, first_name, last_name, role, max_id, phone")
        .eq("is_active", true)
        .order("first_name")
        .then(function (res) {
          if (!res.error && res.data) {
            setEmployeesList(res.data);
            return;
          }
          if (res.error) {
            console.warn("Employees list with max_id/phone failed, retrying without:", res.error.message);
            return supabase
              .from("employees")
              .select("id, email, first_name, last_name, role")
              .eq("is_active", true)
              .order("first_name");
          }
        })
        .then(function (res) {
          if (res && res.data) setEmployeesList(res.data);
        })
        .catch(function (err) {
          console.error("Employees list fetch failed:", err);
          setEmployeesList([]);
        });
      supabase
        .from("objects")
        .select("id, object_name, object_address, assigned_employee_id")
        .eq("is_active", true)
        .not("assigned_employee_id", "is", null)
        .then(function (objRes) {
          if (objRes.error || !objRes.data) return;
          var map = {};
          objRes.data.forEach(function (o) {
            var eid = o.assigned_employee_id;
            if (!map[eid]) map[eid] = [];
            map[eid].push({ name: o.object_name || "", address: o.object_address || "" });
          });
          setAssignedObjectsMap(map);
        });
    }, [viewMode]);

    useEffect(function () {
      if (viewMode !== "edit" || !selectedEmployeeId) {
        setEditObjects([]);
        setEditSelectedObjectIds({});
        return;
      }
      var eid = parseInt(selectedEmployeeId, 10);
      if (!eid) return;
      function fillEditForm(emp) {
        setEditEmail(emp.email || "");
        setEditFirstName(emp.first_name || "");
        setEditLastName(emp.last_name || "");
        setEditMaxId(emp.max_id != null ? emp.max_id : "");
        setEditPhone(emp.phone != null ? emp.phone : "");
        setEditNotifyViaEmail(!!emp.notify_via_email);
        setEditNotifyViaTelegram(!!emp.notify_via_telegram);
        setEditNotifyViaMax(!!emp.notify_via_max);
        setEditRole(emp.role || "user");
        setEditPassword("");
      }
      supabase
        .from("employees")
        .select("id, email, first_name, last_name, role, max_id, phone, notify_via_email, notify_via_telegram, notify_via_max")
        .eq("id", eid)
        .eq("is_active", true)
        .single()
        .then(function (empRes) {
          if (!empRes.error && empRes.data) {
            fillEditForm(empRes.data);
          } else if (empRes.error) {
            supabase
              .from("employees")
              .select("id, email, first_name, last_name, role")
              .eq("id", eid)
              .eq("is_active", true)
              .single()
              .then(function (fallbackRes) {
                if (!fallbackRes.error && fallbackRes.data) {
                  fillEditForm(fallbackRes.data);
                }
              });
          }
        });
      supabase
        .from("objects")
        .select("id, object_name, object_address, assigned_employee_id")
        .eq("is_active", true)
        .or("assigned_employee_id.is.null,assigned_employee_id.eq." + eid)
        .order("object_name")
        .then(function (res) {
          if (!res.error && res.data) {
            setEditObjects(res.data);
            var checked = {};
            res.data.forEach(function (o) {
              if (o.assigned_employee_id === eid) checked[o.id] = true;
            });
            setEditSelectedObjectIds(checked);
          }
        });
    }, [viewMode, selectedEmployeeId]);

    function toggleObject(id) {
      var next = Object.assign({}, selectedObjectIds);
      next[id] = !next[id];
      setSelectedObjectIds(next);
    }

    function copyCredentialsToClipboard() {
      if (!createdCredentials) return;
      var text = "Данные для доступа:\nEmail: " + createdCredentials.email + "\nПароль: " + createdCredentials.password;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          setCopiedToClipboard(true);
          setTimeout(function () { setCopiedToClipboard(false); }, 2000);
        });
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          setCopiedToClipboard(true);
          setTimeout(function () { setCopiedToClipboard(false); }, 2000);
        } catch (e) {}
        document.body.removeChild(ta);
      }
    }

    function toggleEditObject(id) {
      var next = Object.assign({}, editSelectedObjectIds);
      next[id] = !next[id];
      setEditSelectedObjectIds(next);
    }

    function handleEditSubmit(e) {
      e.preventDefault();
      setEditError(null);
      setEditSuccess(null);
      if (!selectedEmployeeId) {
        setEditError("Выберите пользователя.");
        return;
      }
      var eid = parseInt(selectedEmployeeId, 10);
      if (!eid) return;
      if (!editEmail.trim() || !editFirstName.trim()) {
        setEditError("Заполните email и имя.");
        return;
      }
      if (editPassword.length > 0 && editPassword.length < 6) {
        setEditError("Пароль не менее 6 символов.");
        return;
      }
      var phoneResult = normalizePhoneForRussia(editPhone);
      if (!phoneResult.valid) {
        setEditError("Телефон: укажите +7 и 10 цифр (без пробелов и символов).");
        return;
      }
      var token = props.session && props.session.access_token;
      if (!token) {
        setEditError("Нет сессии. Войдите заново.");
        return;
      }
      var objectIds = editRole === "user" ? editObjects.filter(function (o) { return editSelectedObjectIds[o.id]; }).map(function (o) { return o.id; }) : [];
      setEditSubmitting(true);
      var body = {
        employee_id: eid,
        email: editEmail.trim(),
        first_name: editFirstName.trim(),
        last_name: editLastName.trim() || undefined,
        role: editRole,
        object_ids: objectIds,
        max_id: editMaxId.trim() ? editMaxId.trim() : null,
        phone: phoneResult.normalized,
        notify_via_email: editNotifyViaEmail,
        notify_via_telegram: editNotifyViaTelegram,
        notify_via_max: editNotifyViaMax,
      };
      if (editPassword.length >= 6) body.password = editPassword;
      fetch(SUPABASE_URL + "/functions/v1/admin-update-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify(body),
      })
        .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
        .then(function (_ref) {
          var status = _ref.status;
          var data = _ref.data;
          setEditSubmitting(false);
          if (status >= 200 && status < 300) {
            setEditSuccess(data.message || "Параметры сохранены.");
          } else {
            setEditError(data.error || "Ошибка сохранения.");
          }
        })
        .catch(function (err) {
          setEditSubmitting(false);
          setEditError(err.message || "Ошибка сети.");
        });
    }

    function handleDeactivateUser() {
      if (!selectedEmployeeId) {
        setEditError("Выберите пользователя.");
        return;
      }
      
      var eid = parseInt(selectedEmployeeId, 10);
      if (!eid) return;
      
      // Нельзя деактивировать самого себя
      if (eid === props.employee.id) {
        setEditError("Вы не можете деактивировать свой собственный аккаунт.");
        return;
      }
      
      if (!confirm("Деактивировать этого пользователя? Он не сможет войти в систему.")) {
        return;
      }
      
      setEditError(null);
      setEditSuccess(null);
      setEditSubmitting(true);
      
      supabase
        .from("employees")
        .update({ is_active: false })
        .eq("id", eid)
        .then(function (result) {
          setEditSubmitting(false);
          if (result.error) {
            console.error(result.error);
            setEditError("Не удалось деактивировать пользователя: " + result.error.message);
            return;
          }
          
          setEditSuccess("Пользователь деактивирован.");
          
          // Очистить выбор через 1.5 секунды
          setTimeout(function() {
            setSelectedEmployeeId(null);
            setEditEmail("");
            setEditPassword("");
            setEditFirstName("");
            setEditLastName("");
            setEditMaxId("");
            setEditPhone("");
            setEditNotifyViaEmail(false);
            setEditNotifyViaTelegram(false);
            setEditNotifyViaMax(false);
            setEditRole("user");
            setEditSelectedObjectIds({});
            setEditSuccess(null);
          }, 1500);
        })
        .catch(function (err) {
          console.error(err);
          setEditSubmitting(false);
          setEditError("Ошибка деактивации пользователя.");
        });
    }

    function handleSubmit(e) {
      e.preventDefault();
      setError(null);
      setSuccess(null);
      setCreatedCredentials(null);
      if (!email.trim() || !password || !firstName.trim()) {
        setError("Заполните email, пароль и имя.");
        return;
      }
      if (password.length < 6) {
        setError("Пароль не менее 6 символов.");
        return;
      }
      var phoneResult = normalizePhoneForRussia(phone);
      if (!phoneResult.valid) {
        setError("Телефон: укажите +7 и 10 цифр (без пробелов и символов).");
        return;
      }
      var token = props.session && props.session.access_token;
      if (!token) {
        setError("Нет сессии. Войдите заново.");
        return;
      }
      var objectIds = role === "user" ? objects.filter(function (o) { return selectedObjectIds[o.id]; }).map(function (o) { return o.id; }) : [];
      setSubmitting(true);
      fetch(SUPABASE_URL + "/functions/v1/admin-create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
          first_name: firstName.trim(),
          last_name: lastName.trim() || undefined,
          role: role,
          object_ids: objectIds.length ? objectIds : undefined,
          max_id: maxId.trim() ? maxId.trim() : undefined,
          phone: phoneResult.normalized || undefined,
          notify_via_email: notifyViaEmail,
          notify_via_telegram: notifyViaTelegram,
          notify_via_max: notifyViaMax,
        }),
      })
        .then(function (res) { return res.json().then(function (data) { return { status: res.status, data: data }; }); })
        .then(function (_ref) {
          var status = _ref.status;
          var data = _ref.data;
          setSubmitting(false);
          if (status >= 200 && status < 300) {
            setCreatedCredentials({ email: email.trim(), password: password });
            setSuccess(data.message || "Пользователь создан.");
            setEmail("");
            setPassword("");
            setFirstName("");
            setLastName("");
            setMaxId("");
            setPhone("");
            setNotifyViaEmail(false);
            setNotifyViaTelegram(false);
            setNotifyViaMax(false);
            setRole("user");
            setSelectedObjectIds({});
          } else {
            setError(data.error || "Ошибка создания пользователя.");
          }
        })
        .catch(function (err) {
          setSubmitting(false);
          setError(err.message || "Ошибка сети.");
        });
    }

    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { className: "top-bar" },
        React.createElement(
          "button",
          { className: "back-button", onClick: function () { props.onNavigate("menu"); } },
          "← Назад в меню"
        )
      ),
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "panel-title" }, "Управление пользователями"),
          React.createElement("div", { className: "panel-subtitle" }, "Создание учётной записи и назначение роли")
        ),
        React.createElement("span", { className: "badge" }, "Шаг 4")
      ),
      React.createElement("div", { className: "divider" }),
      React.createElement(
        "div",
        { style: { marginBottom: "16px", maxWidth: "400px" } },
        viewMode === "create"
          ? React.createElement(
              "button",
              {
                type: "button",
                className: "button",
                onClick: function () { setViewMode("edit"); setError(null); setSuccess(null); setEditError(null); setEditSuccess(null); setSelectedEmployeeId(""); setEditUserSearch(""); },
              },
              "Изменить пользователя"
            )
          : React.createElement(
              "button",
              {
                type: "button",
                className: "button primary",
                onClick: function () { setViewMode("create"); setError(null); setSuccess(null); setEditError(null); setEditSuccess(null); },
              },
              "Создать учётную запись"
            )
      ),
      viewMode === "create" && React.createElement(
        "form",
        { className: "form", onSubmit: handleSubmit, style: { maxWidth: "400px" } },
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Email (логин)", React.createElement("span", null, "*")),
          React.createElement("input", {
            className: "input",
            type: "email",
            required: true,
            value: email,
            onChange: function (e) { setEmail(e.target.value); },
            disabled: submitting,
            placeholder: "user@example.com",
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Пароль", React.createElement("span", null, "*")),
          React.createElement("input", {
            className: "input",
            type: "password",
            required: true,
            minLength: 6,
            value: password,
            onChange: function (e) { setPassword(e.target.value); },
            disabled: submitting,
            placeholder: "Не менее 6 символов",
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Имя", React.createElement("span", null, "*")),
          React.createElement("input", {
            className: "input",
            type: "text",
            required: true,
            value: firstName,
            onChange: function (e) { setFirstName(e.target.value); },
            disabled: submitting,
            placeholder: "Имя",
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Фамилия"),
          React.createElement("input", {
            className: "input",
            type: "text",
            value: lastName,
            onChange: function (e) { setLastName(e.target.value); },
            disabled: submitting,
            placeholder: "Фамилия",
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Max ID"),
          React.createElement("input", {
            className: "input",
            type: "text",
            value: maxId,
            onChange: function (e) { setMaxId(e.target.value); },
            disabled: submitting,
            placeholder: "Необязательно",
          })
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label" }, "Телефон"),
          React.createElement("input", {
            className: "input",
            type: "tel",
            value: phone,
            onChange: function (e) { setPhone(e.target.value); },
            disabled: submitting,
            placeholder: "+7 и 10 цифр, например +79991234567",
          }),
          React.createElement("div", { className: "hint", style: { marginTop: "4px" } }, "Только +7 и цифры, без пробелов и символов. Сохраняется в формате +79991234567.")
        ),
        React.createElement("div", { className: "divider" }),
        React.createElement("div", { className: "field-label" }, "Получать объявления по контактам"),
        React.createElement("div", { className: "hint", style: { marginBottom: "8px" } }, "Отметьте каналы для объявлений. При включении отображается индикатор."),
        React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", gap: "10px" } },
          React.createElement(
            "label",
            { style: { display: "flex", alignItems: "center", gap: "10px", cursor: submitting ? "default" : "pointer", flexWrap: "wrap" } },
            React.createElement("input", { type: "checkbox", checked: notifyViaEmail, onChange: function () { if (!submitting) setNotifyViaEmail(!notifyViaEmail); }, disabled: submitting }),
            React.createElement("span", { style: { flex: 1 } }, "По Email"),
            React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, email || "—"),
            notifyViaEmail && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
          ),
          React.createElement(
            "label",
            { style: { display: "flex", alignItems: "center", gap: "10px", cursor: submitting ? "default" : "pointer", flexWrap: "wrap" } },
            React.createElement("input", { type: "checkbox", checked: notifyViaTelegram, onChange: function () { if (!submitting) setNotifyViaTelegram(!notifyViaTelegram); }, disabled: submitting }),
            React.createElement("span", { style: { flex: 1 } }, "По Telegram"),
            React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, "привязывается в боте"),
            notifyViaTelegram && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
          ),
          React.createElement(
            "label",
            { style: { display: "flex", alignItems: "center", gap: "10px", cursor: submitting ? "default" : "pointer", flexWrap: "wrap" } },
            React.createElement("input", { type: "checkbox", checked: notifyViaMax, onChange: function () { if (!submitting) setNotifyViaMax(!notifyViaMax); }, disabled: submitting }),
            React.createElement("span", { style: { flex: 1 } }, "По Max ID"),
            React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, maxId || "—"),
            notifyViaMax && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
          )
        ),
        React.createElement(
          "div",
          null,
          React.createElement("div", { className: "field-label", style: { marginBottom: "8px" } }, "Роль"),
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "10px 12px",
                borderRadius: "12px",
                border: "1px solid rgba(148, 163, 184, 0.4)",
                background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 1))",
                color: "#e5e7eb",
              },
            },
            React.createElement(
              "label",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  cursor: submitting ? "default" : "pointer",
                  padding: "8px 10px",
                  borderRadius: "10px",
                  background: role === "user" ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                },
              },
              React.createElement("input", {
                type: "checkbox",
                checked: role === "user",
                onChange: function () { if (!submitting) setRole("user"); },
                disabled: submitting,
                style: { flexShrink: 0 },
              }),
              React.createElement("span", { style: { fontWeight: 500 } }, "Пользователь")
            ),
            React.createElement(
              "label",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  cursor: submitting ? "default" : "pointer",
                  padding: "8px 10px",
                  borderRadius: "10px",
                  background: role === "owner" ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(148, 163, 184, 0.25)",
                },
              },
              React.createElement("input", {
                type: "checkbox",
                checked: role === "owner",
                onChange: function () { if (!submitting) setRole("owner"); },
                disabled: submitting,
                style: { flexShrink: 0 },
              }),
              React.createElement("span", { style: { fontWeight: 500 } }, "Владелец")
            )
          )
        ),
        role === "user" && objects.length > 0 && React.createElement(
          "div",
          { style: { marginTop: "16px" } },
          React.createElement("div", { className: "field-label", style: { marginBottom: "8px" } }, "Объекты для пользователя (выберите один или несколько)"),
          React.createElement(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                maxHeight: "220px",
                overflowY: "auto",
                padding: "10px 12px",
                borderRadius: "12px",
                border: "1px solid rgba(148, 163, 184, 0.4)",
                background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 1))",
                color: "#e5e7eb",
              },
            },
            objects.map(function (obj) {
              var name = obj.object_name || "Объект #" + obj.id;
              var address = obj.object_address ? String(obj.object_address).trim() : "";
              return React.createElement(
                "label",
                {
                  key: obj.id,
                  style: {
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    cursor: submitting ? "default" : "pointer",
                    padding: "8px 10px",
                    borderRadius: "10px",
                    background: "rgba(15, 23, 42, 0.6)",
                    border: "1px solid rgba(148, 163, 184, 0.25)",
                  },
                },
                React.createElement("input", {
                  type: "checkbox",
                  checked: !!selectedObjectIds[obj.id],
                  onChange: function () { toggleObject(obj.id); },
                  disabled: submitting,
                  style: { marginTop: "3px", flexShrink: 0 },
                }),
                React.createElement(
                  "div",
                  { style: { flex: 1, minWidth: 0 } },
                  React.createElement("div", { style: { fontSize: "13px", fontWeight: 500, color: "#e5e7eb" } }, name),
                  address ? React.createElement("div", { style: { fontSize: "12px", color: "#9ca3af", marginTop: "2px" } }, address) : null
                )
              );
            })
          )
        ),
        React.createElement(
          "button",
          { className: "button", type: "submit", disabled: submitting },
          submitting ? "Создание..." : "Создать учётную запись"
        )
      ),
      viewMode === "edit" && React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { style: { marginBottom: "16px" } },
          React.createElement("div", { className: "field-label" }, "Поиск пользователя"),
          React.createElement(
            "div",
            { className: "hint", style: { marginBottom: "8px" } },
            "Поиск по имени, email, телефону, Max ID, роли или по названию/адресу назначенных объектов"
          ),
          React.createElement(
            "div",
            { style: { display: "flex", gap: "8px" } },
            React.createElement("input", {
              className: "input",
              type: "text",
              placeholder: "Имя, email, телефон, объект…",
              value: editUserSearch,
              onChange: function (e) { setEditUserSearch(e.target.value); },
              disabled: editSubmitting,
            }),
            React.createElement(
              "button",
              {
                className: "button",
                type: "button",
                onClick: function () { setEditUserSearch(""); },
                disabled: editSubmitting,
                style: { marginTop: 0 },
              },
              editUserSearch.trim() ? "Очистить" : "Обновить"
            )
          )
        ),
        (function () {
          var q = (editUserSearch || "").trim().toLowerCase();
          if (!q) {
            return React.createElement(
              "div",
              { style: { marginBottom: "20px" } },
              React.createElement("div", { className: "field-label" }, "Пользователей: " + employeesList.length + " (отсортированы по алфавиту)"),
              React.createElement(
                "div",
                { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                employeesList.map(function (emp) {
                  var name = (emp.first_name || "") + " " + (emp.last_name || "").trim();
                  var sub = (emp.email || "") + " — " + (emp.role === "owner" ? "Владелец" : "Пользователь");
                  var isSelected = String(emp.id) === selectedEmployeeId;
                  return React.createElement(
                    "div",
                    {
                      key: emp.id,
                      className: "user-card",
                      onClick: function () { setSelectedEmployeeId(isSelected ? "" : String(emp.id)); },
                      style: { cursor: "pointer" },
                    },
                    React.createElement(
                      "div",
                      { className: "user-card-main" },
                      React.createElement(
                        "div",
                        { className: "user-meta" },
                        React.createElement("div", { className: "user-name" }, name || "—"),
                        React.createElement("div", { className: "user-role" }, sub)
                      )
                    ),
                    React.createElement(
                      "button",
                      {
                        className: "button-ghost",
                        type: "button",
                        onClick: function (e) {
                          e.stopPropagation();
                          setSelectedEmployeeId(isSelected ? "" : String(emp.id));
                        },
                      },
                      isSelected ? "Отменить выбор" : "Выбрать →"
                    )
                  );
                })
              )
            );
          }
          var filtered = employeesList.filter(function (emp) {
            var name = ((emp.first_name || "") + " " + (emp.last_name || "")).trim().toLowerCase();
            var email = (emp.email || "").toLowerCase();
            var roleStr = (emp.role === "owner" ? "владелец" : "пользователь");
            var maxIdStr = (emp.max_id || "").toLowerCase();
            var phoneStr = (emp.phone || "").replace(/\D/g, "");
            var qDigits = q.replace(/\D/g, "");
            if (name.indexOf(q) >= 0 || email.indexOf(q) >= 0 || roleStr.indexOf(q) >= 0 || maxIdStr.indexOf(q) >= 0) return true;
            if (qDigits.length >= 3 && phoneStr.indexOf(qDigits) >= 0) return true;
            var assigned = assignedObjectsMap[emp.id] || [];
            for (var i = 0; i < assigned.length; i++) {
              if ((assigned[i].name || "").toLowerCase().indexOf(q) >= 0 || (assigned[i].address || "").toLowerCase().indexOf(q) >= 0) return true;
            }
            return false;
          });
          return filtered.length > 0
            ? React.createElement(
                "div",
                { style: { marginBottom: "20px" } },
                React.createElement(
                  "div",
                  { className: "field-label" },
                  q ? "Найдено пользователей: " + filtered.length : "Пользователей: " + filtered.length + " (отсортированы по алфавиту)"
                ),
                React.createElement(
                  "div",
                  { style: { display: "flex", flexDirection: "column", gap: "8px" } },
                  filtered.map(function (emp) {
                    var name = (emp.first_name || "") + " " + (emp.last_name || "").trim();
                    var sub = (emp.email || "") + " — " + (emp.role === "owner" ? "Владелец" : "Пользователь");
                    var isSelected = String(emp.id) === selectedEmployeeId;
                    return React.createElement(
                      "div",
                      {
                        key: emp.id,
                        className: "user-card",
                        onClick: function () { setSelectedEmployeeId(isSelected ? "" : String(emp.id)); },
                        style: { cursor: "pointer" },
                      },
                      React.createElement(
                        "div",
                        { className: "user-card-main" },
                        React.createElement(
                          "div",
                          { className: "user-meta" },
                          React.createElement("div", { className: "user-name" }, name || "—"),
                          React.createElement("div", { className: "user-role" }, sub)
                        )
                      ),
                      React.createElement(
                        "button",
                        {
                          className: "button-ghost",
                          type: "button",
                          onClick: function (e) {
                            e.stopPropagation();
                            setSelectedEmployeeId(isSelected ? "" : String(emp.id));
                          },
                        },
                        isSelected ? "Отменить выбор" : "Выбрать →"
                      )
                    );
                  })
                )
              )
            : React.createElement(
                "div",
                { style: { marginBottom: "20px", padding: "12px", color: "var(--text-muted)", fontSize: "13px" } },
                "Никого не найдено. Измените запрос или очистите поиск."
              );
        })(),
        React.createElement(
          "form",
          { className: "form", onSubmit: handleEditSubmit, style: { maxWidth: "400px" } },
          selectedEmployeeId && React.createElement(
            "div",
            null,
            React.createElement(
              "button",
              {
                type: "button",
                className: "button-ghost",
                onClick: function () { setSelectedEmployeeId(""); },
                style: { marginBottom: "12px", padding: "4px 0" },
              },
              "← Выбрать другого пользователя"
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Email (логин)", React.createElement("span", null, "*")),
              React.createElement("input", {
                className: "input",
                type: "email",
                required: true,
                value: editEmail,
                onChange: function (e) { setEditEmail(e.target.value); },
                disabled: editSubmitting,
                placeholder: "user@example.com",
              })
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Новый пароль (оставьте пустым, чтобы не менять)"),
              React.createElement("input", {
                className: "input",
                type: "password",
                value: editPassword,
                onChange: function (e) { setEditPassword(e.target.value); },
                disabled: editSubmitting,
                placeholder: "Не менее 6 символов",
              })
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Имя", React.createElement("span", null, "*")),
              React.createElement("input", {
                className: "input",
                type: "text",
                required: true,
                value: editFirstName,
                onChange: function (e) { setEditFirstName(e.target.value); },
                disabled: editSubmitting,
                placeholder: "Имя",
              })
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Фамилия"),
              React.createElement("input", {
                className: "input",
                type: "text",
                value: editLastName,
                onChange: function (e) { setEditLastName(e.target.value); },
                disabled: editSubmitting,
                placeholder: "Фамилия",
              })
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Max ID"),
              React.createElement("input", {
                className: "input",
                type: "text",
                value: editMaxId,
                onChange: function (e) { setEditMaxId(e.target.value); },
                disabled: editSubmitting,
                placeholder: "Необязательно",
              })
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label" }, "Телефон"),
              React.createElement("input", {
                className: "input",
                type: "tel",
                value: editPhone,
                onChange: function (e) { setEditPhone(e.target.value); },
                disabled: editSubmitting,
                placeholder: "+7 и 10 цифр, например +79991234567",
              }),
              React.createElement("div", { className: "hint", style: { marginTop: "4px" } }, "Только +7 и цифры. Сохраняется в формате +79991234567.")
            ),
            React.createElement("div", { className: "divider" }),
            React.createElement("div", { className: "field-label" }, "Получать объявления по контактам"),
            React.createElement("div", { className: "hint", style: { marginBottom: "8px" } }, "Отметьте каналы для объявлений. При включении отображается индикатор."),
            React.createElement(
              "div",
              { style: { display: "flex", flexDirection: "column", gap: "10px" } },
              React.createElement(
                "label",
                { style: { display: "flex", alignItems: "center", gap: "10px", cursor: editSubmitting ? "default" : "pointer", flexWrap: "wrap" } },
                React.createElement("input", { type: "checkbox", checked: editNotifyViaEmail, onChange: function () { if (!editSubmitting) setEditNotifyViaEmail(!editNotifyViaEmail); }, disabled: editSubmitting }),
                React.createElement("span", { style: { flex: 1 } }, "По Email"),
                React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, editEmail || "—"),
                editNotifyViaEmail && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
              ),
              React.createElement(
                "label",
                { style: { display: "flex", alignItems: "center", gap: "10px", cursor: editSubmitting ? "default" : "pointer", flexWrap: "wrap" } },
                React.createElement("input", { type: "checkbox", checked: editNotifyViaTelegram, onChange: function () { if (!editSubmitting) setEditNotifyViaTelegram(!editNotifyViaTelegram); }, disabled: editSubmitting }),
                React.createElement("span", { style: { flex: 1 } }, "По Telegram"),
                React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, "привязывается в боте"),
                editNotifyViaTelegram && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
              ),
              React.createElement(
                "label",
                { style: { display: "flex", alignItems: "center", gap: "10px", cursor: editSubmitting ? "default" : "pointer", flexWrap: "wrap" } },
                React.createElement("input", { type: "checkbox", checked: editNotifyViaMax, onChange: function () { if (!editSubmitting) setEditNotifyViaMax(!editNotifyViaMax); }, disabled: editSubmitting }),
                React.createElement("span", { style: { flex: 1 } }, "По Max ID"),
                React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)" } }, editMaxId || "—"),
                editNotifyViaMax && React.createElement("span", { style: { padding: "2px 8px", borderRadius: "999px", background: "rgba(56, 189, 248, 0.2)", fontSize: "11px", fontWeight: 600 } }, "Вкл")
              )
            ),
            React.createElement(
              "div",
              null,
              React.createElement("div", { className: "field-label", style: { marginBottom: "8px" } }, "Роль"),
              React.createElement(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    padding: "10px 12px",
                    borderRadius: "12px",
                    border: "1px solid rgba(148, 163, 184, 0.4)",
                    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 1))",
                    color: "#e5e7eb",
                  },
                },
                React.createElement(
                  "label",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      cursor: editSubmitting ? "default" : "pointer",
                      padding: "8px 10px",
                      borderRadius: "10px",
                      background: editRole === "user" ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.6)",
                      border: "1px solid rgba(148, 163, 184, 0.25)",
                    },
                  },
                  React.createElement("input", {
                    type: "checkbox",
                    checked: editRole === "user",
                    onChange: function () { if (!editSubmitting) setEditRole("user"); },
                    disabled: editSubmitting,
                    style: { flexShrink: 0 },
                  }),
                  React.createElement("span", { style: { fontWeight: 500 } }, "Пользователь")
                ),
                React.createElement(
                  "label",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      cursor: editSubmitting ? "default" : "pointer",
                      padding: "8px 10px",
                      borderRadius: "10px",
                      background: editRole === "owner" ? "rgba(56, 189, 248, 0.15)" : "rgba(15, 23, 42, 0.6)",
                      border: "1px solid rgba(148, 163, 184, 0.25)",
                    },
                  },
                  React.createElement("input", {
                    type: "checkbox",
                    checked: editRole === "owner",
                    onChange: function () { if (!editSubmitting) setEditRole("owner"); },
                    disabled: editSubmitting,
                    style: { flexShrink: 0 },
                  }),
                  React.createElement("span", { style: { fontWeight: 500 } }, "Владелец")
                )
              )
            ),
            editRole === "user" && editObjects.length > 0 && React.createElement(
              "div",
              { style: { marginTop: "16px" } },
              React.createElement("div", { className: "field-label", style: { marginBottom: "8px" } }, "Объекты для пользователя (выберите один или несколько)"),
              React.createElement(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                    maxHeight: "220px",
                    overflowY: "auto",
                    padding: "10px 12px",
                    borderRadius: "12px",
                    border: "1px solid rgba(148, 163, 184, 0.4)",
                    background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 1))",
                    color: "#e5e7eb",
                  },
                },
                editObjects.map(function (obj) {
                  var name = obj.object_name || "Объект #" + obj.id;
                  var address = obj.object_address ? String(obj.object_address).trim() : "";
                  return React.createElement(
                    "label",
                    {
                      key: obj.id,
                      style: {
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                        cursor: editSubmitting ? "default" : "pointer",
                        padding: "8px 10px",
                        borderRadius: "10px",
                        background: "rgba(15, 23, 42, 0.6)",
                        border: "1px solid rgba(148, 163, 184, 0.25)",
                      },
                    },
                    React.createElement("input", {
                      type: "checkbox",
                      checked: !!editSelectedObjectIds[obj.id],
                      onChange: function () { toggleEditObject(obj.id); },
                      disabled: editSubmitting,
                      style: { marginTop: "3px", flexShrink: 0 },
                    }),
                    React.createElement(
                      "div",
                      { style: { flex: 1, minWidth: 0 } },
                      React.createElement("div", { style: { fontSize: "13px", fontWeight: 500, color: "#e5e7eb" } }, name),
                      address ? React.createElement("div", { style: { fontSize: "12px", color: "#9ca3af", marginTop: "2px" } }, address) : null
                    )
                  );
                })
              )
            ),
            React.createElement(
              "div",
              { style: { display: "flex", gap: "12px", marginTop: "16px" } },
              React.createElement(
                "button",
                { className: "button", type: "submit", disabled: editSubmitting, style: { flex: 1 } },
                editSubmitting ? "Сохранение..." : "Сохранить параметры"
              ),
              React.createElement(
                "button",
                { 
                  className: "button button-secondary", 
                  type: "button", 
                  onClick: handleDeactivateUser, 
                  disabled: editSubmitting,
                  style: { 
                    flex: 1,
                    background: "linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(220, 38, 38, 0.15))",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "#fca5a5"
                  } 
                },
                editSubmitting ? "Деактивация..." : "Деактивировать пользователя"
              )
            )
          )
        )
      ),
      viewMode === "create" && error && React.createElement(
        "div",
        { className: "alert alert-error", style: { marginTop: "16px" } },
        React.createElement("div", { className: "alert-icon" }, "!"),
        React.createElement(
          "div",
          { className: "alert-body" },
          React.createElement("div", { className: "alert-title" }, "Ошибка"),
          React.createElement("div", { className: "alert-text" }, error)
        )
      ),
      viewMode === "create" && success && React.createElement(
        "div",
        { className: "alert alert-success", style: { marginTop: "16px" } },
        React.createElement("div", { className: "alert-icon" }, "✓"),
        React.createElement(
          "div",
          { className: "alert-body" },
          React.createElement("div", { className: "alert-title" }, "Готово"),
          React.createElement("div", { className: "alert-text" }, success)
        )
      ),
      viewMode === "edit" && editError && React.createElement(
        "div",
        { className: "alert alert-error", style: { marginTop: "16px" } },
        React.createElement("div", { className: "alert-icon" }, "!"),
        React.createElement(
          "div",
          { className: "alert-body" },
          React.createElement("div", { className: "alert-title" }, "Ошибка"),
          React.createElement("div", { className: "alert-text" }, editError)
        )
      ),
      viewMode === "edit" && editSuccess && React.createElement(
        "div",
        { className: "alert alert-success", style: { marginTop: "16px" } },
        React.createElement("div", { className: "alert-icon" }, "✓"),
        React.createElement(
          "div",
          { className: "alert-body" },
          React.createElement("div", { className: "alert-title" }, "Готово"),
          React.createElement("div", { className: "alert-text" }, editSuccess)
        )
      ),
      viewMode === "create" && createdCredentials && React.createElement(
        "div",
        {
          role: "button",
          tabIndex: 0,
          onClick: copyCredentialsToClipboard,
          onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); copyCredentialsToClipboard(); } },
          style: {
            marginTop: "20px",
            padding: "16px 18px",
            borderRadius: "12px",
            border: "2px solid rgba(56, 189, 248, 0.5)",
            background: "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 1))",
            maxWidth: "400px",
            cursor: "pointer",
            userSelect: "none",
            WebkitTapHighlightColor: "transparent",
          },
        },
        React.createElement("div", { style: { fontWeight: 600, marginBottom: "10px", fontSize: "1rem", color: "#e5e7eb" } }, "Данные для доступа: email и пароль"),
        React.createElement("div", { style: { fontSize: "12px", color: "#9ca3af", marginBottom: "10px" } }, copiedToClipboard ? "Скопировано!" : "Нажмите или коснитесь, чтобы скопировать"),
        React.createElement("div", { style: { marginBottom: "8px", color: "#e5e7eb" } },
          React.createElement("span", { style: { fontWeight: 500 } }, "Email: "),
          React.createElement("span", { style: { fontFamily: "monospace", wordBreak: "break-all" } }, createdCredentials.email)
        ),
        React.createElement("div", { style: { color: "#e5e7eb" } },
          React.createElement("span", { style: { fontWeight: 500 } }, "Пароль: "),
          React.createElement("span", { style: { fontFamily: "monospace", wordBreak: "break-all" } }, createdCredentials.password)
        )
      )
    );
  }

  // ---------- ОСНОВНОЙ SHELL С НАВИГАЦИЕЙ ----------

  function MainShell(props) {
    var currentScreenState = useState("menu");
    var currentScreen = currentScreenState[0];
    var setCurrentScreen = currentScreenState[1];

    var counterTypesState = useState([]);
    var counterTypes = counterTypesState[0];
    var setCounterTypes = counterTypesState[1];

    var ownersState = useState([]);
    var owners = ownersState[0];
    var setOwners = ownersState[1];

    var operatorsState = useState([]);
    var operators = operatorsState[0];
    var setOperators = operatorsState[1];

    // Load counter types and owners from database on mount
    useEffect(function () {
      if (!supabase) return;
      
      supabase
        .from("counter_types")
        .select("name")
        .eq("is_active", true)
        .order("sort_order")
        .then(function (res) {
          if (!res.error && res.data) {
            setCounterTypes(res.data.map(function (r) { return r.name; }));
          }
        })
        .catch(function (err) {
          console.error("Failed to load counter types:", err);
        });

      supabase
        .from("owners")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order")
        .then(function (res) {
          if (!res.error && res.data) {
            setOwners(res.data);
          }
        })
        .catch(function (err) {
          console.error("Failed to load owners:", err);
        });

      supabase
        .from("operators")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order")
        .then(function (res) {
          if (!res.error && res.data) {
            setOperators(res.data);
          }
        })
        .catch(function (err) {
          console.error("Failed to load operators:", err);
        });
    }, []);

    function handleNavigate(screen) {
      setCurrentScreen(screen);
    }

    var screenContent;
    if (currentScreen === "menu") {
      screenContent = React.createElement(MainMenu, {
        employee: props.employee,
        onLogout: props.onLogout,
        onNavigate: handleNavigate,
      });
    } else if (currentScreen === "readings") {
      screenContent = React.createElement(ReadingsScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
        employee: props.employee,
        counterTypes: counterTypes,
      });
    } else if (currentScreen === "create-object") {
      screenContent = React.createElement(CreateObjectScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
        counterTypes: counterTypes,
        owners: owners,
        operators: operators,
      });
    } else if (currentScreen === "edit-object") {
      screenContent = React.createElement(EditObjectScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
        counterTypes: counterTypes,
        owners: owners,
        operators: operators,
      });
    } else if (currentScreen === "stats") {
      screenContent = React.createElement(StatsScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
        employee: props.employee,
        counterTypes: counterTypes,
      });
    } else if (currentScreen === "operators") {
      screenContent = React.createElement(OperatorsScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
      });
    } else if (currentScreen === "archive") {
      screenContent = React.createElement(ArchiveScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
      });
    } else if (currentScreen === "users") {
      screenContent = React.createElement(UserManagementScreen, {
        onNavigate: handleNavigate,
        onLogout: props.onLogout,
        session: props.session,
        employee: props.employee,
      });
    } else if (currentScreen === "telegram") {
      screenContent = React.createElement(TelegramScreen, {
        employee: props.employee,
        onNavigate: handleNavigate,
      });
    }

    return React.createElement("div", { className: "panel" }, screenContent);
  }

  function RightColumn(props) {
    var isLoggedIn = !!props.session && !!props.employee;
    var emp = props.employee || {};

    return React.createElement(
      "div",
      { className: "layout-right" },
      React.createElement(
        "div",
        { className: "panel" },
        React.createElement(
          "div",
          { className: "panel-header" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              { className: "panel-title" },
              isLoggedIn ? "Статус системы" : "Вы не авторизованы"
            ),
            React.createElement(
              "div",
              { className: "panel-subtitle" },
              isLoggedIn
                ? "Блок 02 — Главное меню"
                : "Внутренняя система учёта энергоресурсов"
            )
          )
        ),
        isLoggedIn
          ? React.createElement(
              "div",
              null,
              React.createElement(
                "div",
                { className: "stack" },
                React.createElement(
                  "div",
                  { className: "stack-row" },
                  React.createElement(
                    "div",
                    { className: "stack-label" },
                    "Сотрудник"
                  ),
                  React.createElement(
                    "div",
                    { className: "stack-value" },
                    emp.first_name || "—",
                    " ",
                    emp.last_name || ""
                  )
                ),
                React.createElement(
                  "div",
                  { className: "stack-row" },
                  React.createElement(
                    "div",
                    { className: "stack-label" },
                    "Статус"
                  ),
                  React.createElement(
                    "div",
                    { className: "stack-value" },
                    "Доступ разрешён"
                  )
                )
              ),
              React.createElement("div", { className: "separation" }),
              React.createElement(
                "div",
                { className: "hint" },
                "Основной экран — «Внести показания». Поиск объекта, выбор даты и ввод показаний счётчиков."
              )
            )
          : React.createElement(
              "div",
              null,
              React.createElement(
                "div",
                { className: "stack" },
                React.createElement(
                  "div",
                  { className: "stack-row" },
                  React.createElement(
                    "div",
                    { className: "stack-label" },
                    "Статус"
                  ),
                  React.createElement(
                    "div",
                    { className: "stack-value" },
                    "Доступ только по логину и паролю"
                  )
                )
              ),
              React.createElement("div", { className: "separation" }),
              React.createElement(
                "div",
                { className: "hint" },
                "Введите свой корпоративный email и пароль, чтобы получить доступ к системе."
              )
            )
      )
    );
  }

  function TelegramScreen(props) {
    var linkTokenState = useState(null);
    var linkToken = linkTokenState[0];
    var setLinkToken = linkTokenState[1];

    var loadingState = useState(false);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    var successState = useState(false);
    var success = successState[0];
    var setSuccess = successState[1];

    var tgLinkedState = useState(!!props.employee.tg_id);
    var tgLinked = tgLinkedState[0];
    var setTgLinked = tgLinkedState[1];

    var checkingStatusState = useState(false);
    var checkingStatus = checkingStatusState[0];
    var setCheckingStatus = checkingStatusState[1];

    var checkIntervalState = useState(null);
    var checkInterval = checkIntervalState[0];
    var setCheckInterval = checkIntervalState[1];

    useEffect(function () {
      setTgLinked(!!props.employee.tg_id);
      supabase
        .from("employees")
        .select("tg_id")
        .eq("id", props.employee.id)
        .single()
        .then(function (result) {
          if (result.data && result.data.tg_id) {
            props.employee.tg_id = result.data.tg_id;
            setTgLinked(true);
          } else {
            setTgLinked(false);
            generateLinkToken();
          }
        })
        .catch(function (err) {
          console.error("Error refreshing tg_id:", err);
          if (!props.employee.tg_id) {
            generateLinkToken();
          } else {
            setTgLinked(true);
          }
        });
    }, []);

    useEffect(function () {
      return function () {
        if (checkInterval) {
          clearInterval(checkInterval);
        }
      };
    }, [checkInterval]);

    function startCheckingStatus() {
      if (checkInterval) {
        clearInterval(checkInterval);
      }

      setCheckingStatus(true);
      
      var intervalId = setInterval(function () {
        supabase
          .from("employees")
          .select("tg_id")
          .eq("id", props.employee.id)
          .single()
          .then(function (result) {
            if (result.error) {
              return;
            }

            if (result.data && result.data.tg_id) {
              clearInterval(intervalId);
              setCheckInterval(null);
              setCheckingStatus(false);
              alert("✅ Telegram успешно привязан! Страница обновится.");
              window.location.reload();
            }
          })
          .catch(function (err) {
            console.error("Error checking tg_id:", err);
          });
      }, 3000);

      setCheckInterval(intervalId);
    }

    function stopCheckingStatus() {
      if (checkInterval) {
        clearInterval(checkInterval);
        setCheckInterval(null);
      }
      setCheckingStatus(false);
    }

    function generateLinkToken() {
      setError(null);
      setSuccess(false);
      setLoading(true);

      var token = Math.random().toString(36).substring(2) + Date.now().toString(36);
      var expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      supabase
        .rpc("save_link_token", {
          p_employee_id: props.employee.id,
          p_token: token,
          p_expires_at: expiresAt.toISOString(),
        })
        .then(function (result) {
          if (result.error) {
            setError("Не удалось создать токен привязки: " + result.error.message);
            setLoading(false);
            return;
          }

          if (result.data === false) {
            setError("Нет прав для сохранения токена. Обратитесь к администратору.");
            setLoading(false);
            return;
          }

          setLinkToken(token);
          setLoading(false);
          startCheckingStatus();
        })
        .catch(function (err) {
          console.error("❌ Catch error:", err);
          setError("Ошибка при генерации токена");
          setLoading(false);
        });
    }

    function handleUnlink() {
      if (!confirm("Отвязать Telegram аккаунт?")) {
        return;
      }

      setError(null);
      setSuccess(false);
      setLoading(true);

      supabase
        .from("employees")
        .update({ tg_id: null, link_token: null, link_expires_at: null })
        .eq("id", props.employee.id)
        .then(function (result) {
          if (result.error) {
            console.error(result.error);
            setError("Не удалось отвязать Telegram: " + result.error.message);
            setLoading(false);
            return;
          }

          setSuccess(true);
          setTgLinked(false);
          setLinkToken(null);
          setLoading(false);
          
          setTimeout(function() {
            window.location.reload();
          }, 1000);
        })
        .catch(function (err) {
          console.error(err);
          setError("Ошибка при отвязке Telegram");
          setLoading(false);
        });
    }

    var deepLink = linkToken
      ? "https://t.me/money_cheking_bot?start=" + linkToken
      : "";

    return React.createElement(
      "div",
      null,
      React.createElement(
        "div",
        { className: "top-bar" },
        React.createElement(
          "button",
          {
            className: "back-button",
            onClick: function () {
              props.onNavigate("menu");
            },
          },
          "← Назад в меню"
        )
      ),
      React.createElement(
        "div",
        { className: "panel-header" },
        React.createElement(
          "div",
          null,
          React.createElement(
            "div",
            { className: "panel-title" },
            "Telegram"
          ),
          React.createElement(
            "div",
            { className: "panel-subtitle" },
            "Привязка аккаунта для уведомлений"
          )
        ),
        React.createElement(
          "span",
          { className: "badge" },
          tgLinked ? "Привязан ✓" : "Не привязан"
        )
      ),
      React.createElement("div", { className: "divider" }),
      !tgLinked
        ? React.createElement(
            "div",
            null,
            React.createElement(
              "a",
              {
                href: deepLink || "https://t.me/money_cheking_bot",
                target: "_blank",
                rel: "noopener noreferrer",
                className: "button",
                style: {
                  display: "inline-block",
                  textDecoration: "none",
                  opacity: loading ? 0.6 : 1,
                  pointerEvents: loading ? "none" : "auto",
                },
              },
              "Открыть @money_cheking_bot"
            )
          )
        : React.createElement(
            "div",
            null,
            React.createElement(
              "div",
              {
                className: "alert alert-success",
                style: { marginBottom: "16px" },
              },
              React.createElement("div", { className: "alert-icon" }, "✓"),
              React.createElement(
                "div",
                { className: "alert-body" },
                React.createElement(
                  "div",
                  { className: "alert-title" },
                  "Telegram привязан"
                ),
                React.createElement(
                  "div",
                  { className: "alert-text" },
                  "Вы будете получать уведомления в Telegram"
                )
              )
            ),
            React.createElement(
              "div",
              { className: "hint", style: { marginBottom: "16px" } },
              "Ваш Telegram ID: " + props.employee.tg_id
            ),
            React.createElement(
              "button",
              {
                className: "button",
                onClick: handleUnlink,
                disabled: loading,
                style: {
                  background: "linear-gradient(135deg, #dc2626, #991b1b)",
                  borderColor: "rgba(248, 113, 113, 0.9)",
                },
              },
              loading ? "Отвязка..." : "Отвязать Telegram"
            )
          ),
      error &&
        React.createElement(
          "div",
          { className: "alert alert-error", style: { marginTop: "16px" } },
          React.createElement("div", { className: "alert-icon" }, "!"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement("div", { className: "alert-title" }, "Ошибка"),
            React.createElement("div", { className: "alert-text" }, error)
          )
        ),
      success &&
        React.createElement(
          "div",
          { className: "alert alert-success", style: { marginTop: "16px" } },
          React.createElement("div", { className: "alert-icon" }, "✓"),
          React.createElement(
            "div",
            { className: "alert-body" },
            React.createElement(
              "div",
              { className: "alert-title" },
              "Успешно"
            ),
            React.createElement(
              "div",
              { className: "alert-text" },
              "Telegram успешно отвязан"
            )
          )
        )
    );
  }

  function App() {
    var auth = useAuth();
    var session = auth.session;
    var employee = auth.employee;
    var loading = auth.loading;
    var error = auth.error;
    var login = auth.login;
    var logout = auth.logout;
    var supabaseReady = auth.supabaseReady;

    return React.createElement(
      "div",
      { className: "app-shell" },
      React.createElement(
        "header",
        { className: "app-header" },
        React.createElement(
          "div",
          { className: "app-title" },
          React.createElement("div", { className: "app-logo" }),
          React.createElement(
            "div",
            { className: "app-title-main" },
            "Энергомониторинг"
          )
        )
      ),
      React.createElement(
        "main",
        { className: "app-main" },
        !session || !employee
          ? React.createElement(LoginForm, {
              onLogin: login,
              error: error,
              loading: loading,
              supabaseReady: supabaseReady,
            })
          : React.createElement(MainShell, {
              employee: employee,
              session: session,
              onLogout: logout,
            })
      )
    );
  }

  var container = document.getElementById("root");
  ReactDOM.createRoot(container).render(React.createElement(App));
  if (container && container.dataset) {
    container.dataset.app = "ready";
  }
})();
